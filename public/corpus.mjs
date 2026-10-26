// 語料庫: list of all records, and an editor that steps through them one by one.
// AI-written records arrive here as "待審核"; 「核准，下一筆」 approves and moves to the next one waiting.
import { $, state, saveDb, situationOf, fillSelect, valueLabel, filterOptions, situationOptions, choiceOptions, NEW_LABEL, confirmDiscard, views, showView, speak, stopAudio } from "./app.mjs";
import { uid, filterRecords, splitChunks, validateRecord, recordKey } from "./model.mjs";

let list = [], index = -1, creating = false, dirty = false;
const status = (t) => { $("c-status").textContent = t; };
const recordAt = (i) => state.db.records.find((x) => x.id === list[i]?.id);

function refreshFilters() {
  fillSelect($("c-situation"), situationOptions("全部情境 All"));
  fillSelect($("c-intention"), filterOptions("intention", "全部目的 All"));
  fillSelect($("c-channel"), filterOptions("channel", "全部形式 All"));
}
function computeList() {
  list = filterRecords(state.db, { situationId: $("c-situation").value, intention: $("c-intention").value, channel: $("c-channel").value, review: $("c-review").value, search: $("c-search").value });
}
function renderList() {
  computeList();
  paintList();
}
// Draws `list` as it is; on wide screens the list stays visible next to the editor.
function paintList() {
  $("c-count").textContent = list.length + " 筆 records";
  $("c-list").replaceChildren(...list.map((r, i) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "record" + (r.reviewed ? "" : " pending") + (i === index && !creating ? " current" : "") });
    const meta = Object.assign(document.createElement("span"), { className: "record-meta", textContent: [situationOf(r.situationId)?.title, valueLabel(r.intention), valueLabel(r.channel)].join(" · ") + (r.mastered ? " · 熟練 Mastered" : "") });
    if (!r.reviewed) meta.prepend(Object.assign(document.createElement("span"), { className: "badge", textContent: "待審核 To review" }), " ");
    b.append(meta, Object.assign(document.createElement("span"), { className: "record-text", textContent: r.reply }));
    b.onclick = () => showRecord(i);
    return b;
  }));
  if (!list.length) $("c-list").append(Object.assign(document.createElement("p"), { className: "muted", textContent: state.db.records.length ? "沒有符合條件的語料。" : "還沒有語料，到「新增情境」建立。" }));
}
function showListView() {
  stopAudio();
  dirty = false;
  creating = false;
  index = -1;
  $("c-record").hidden = true;
  $("c-list-view").hidden = false;
  refreshFilters();
  renderList();
}

function fillIntention(value) {
  fillSelect($("r-intention"), choiceOptions("intention", value, true));
  $("r-intention").value = value;
  $("r-new-intention").hidden = true;
  $("r-new-intention").value = "";
}
function fillEditor(r, s) {
  $("r-title").value = s?.title ?? "";
  $("r-description").value = s?.description ?? "";
  fillIntention(r.intention);
  fillSelect($("r-channel"), choiceOptions("channel", r.channel));
  $("r-channel").value = r.channel;
  $("r-reply").value = r.reply;
  $("r-chunks").value = r.chunks.join("; ");
  $("r-mastered").checked = r.mastered;
  const siblings = s ? state.db.records.filter((x) => x.situationId === s.id).length : 0;
  $("r-shared").textContent = siblings > 1 ? "情境名稱與說明由 " + siblings + " 筆語料共用" : "";
}
function showEditor() {
  $("c-list-view").hidden = true;
  $("c-record").hidden = false;
  status("");
}

function showRecord(i) {
  if (i < 0 || i >= list.length) return;
  if ((i !== index || creating) && dirty && !confirmDiscard()) return;
  const r = recordAt(i);
  if (!r) return showListView();
  stopAudio();
  index = i;
  creating = false;
  dirty = false;
  $("r-situation-pick").hidden = $("r-situation-pick-label").hidden = true;
  $("c-pos").textContent = i + 1 + " / " + list.length;
  $("c-prev").hidden = $("c-next").hidden = false;
  $("c-prev").disabled = i === 0;
  $("c-next").disabled = i === list.length - 1;
  $("r-pending").hidden = r.reviewed;
  $("r-approve").hidden = r.reviewed;
  $("r-save").className = r.reviewed ? "primary" : "secondary";
  $("r-delete").hidden = false;
  fillEditor(r, situationOf(r.situationId));
  [...$("c-list").children].forEach((b, n) => b.classList.toggle("current", n === i));
  $("c-list").children[i]?.scrollIntoView?.({ block: "nearest" });
  showEditor();
}

// A hand-written record for an existing situation; it counts as reviewed.
function showNew() {
  if (!state.db.situations.length) return status("請先到「新增情境」建立情境。");
  creating = true;
  dirty = false;
  index = -1;
  const pick = $("r-situation-pick");
  fillSelect(pick, state.db.situations.map((s) => [s.id, s.title || "（未命名 Untitled）"]));
  if ($("c-situation").value) pick.value = $("c-situation").value;
  pick.hidden = $("r-situation-pick-label").hidden = false;
  $("c-pos").textContent = "新增一筆";
  $("c-prev").hidden = $("c-next").hidden = true;
  $("r-pending").hidden = $("r-approve").hidden = $("r-delete").hidden = true;
  $("r-save").className = "primary";
  fillEditor({ intention: "", channel: "", reply: "", chunks: [], mastered: false }, situationOf(pick.value));
  showEditor();
}

// Reads the form; returns { record, situation, newIntention } or { error }.
function readForm(base) {
  const situationId = creating ? $("r-situation-pick").value : base.situationId;
  const title = $("r-title").value.trim(), description = $("r-description").value.trim();
  const newIntention = $("r-intention").value === NEW_LABEL ? $("r-new-intention").value.trim() : "";
  if ($("r-intention").value === NEW_LABEL && !newIntention) return { error: "請輸入新的回應目的。" };
  const record = { ...base, situationId, intention: newIntention || $("r-intention").value, channel: $("r-channel").value, reply: $("r-reply").value.trim(), chunks: splitChunks($("r-chunks").value), mastered: $("r-mastered").checked };
  // Only this record is checked: incomplete sibling records must not block saving it.
  const error = !title ? "請填寫情境名稱。" : !description ? "請填寫情境說明。" : validateRecord(record)
    || (state.db.records.some((x) => x.id !== record.id && recordKey(x) === recordKey(record)) ? "此情境已有回應目的、溝通形式、語塊都相同的語料。" : "");
  return error ? { error } : { record, title, description, newIntention };
}

async function save({ approve = false } = {}) {
  const base = creating ? { id: uid(), reviewed: true, createdAt: Date.now() } : recordAt(index);
  if (!base) return status("這筆語料已不存在。");
  const form = readForm(base);
  if (form.error) return status(form.error);
  const record = approve ? { ...form.record, reviewed: true } : form.record;
  try {
    await saveDb((db) => {
      Object.assign(db.situations.find((s) => s.id === record.situationId), { title: form.title, description: form.description });
      if (form.newIntention && !db.intentions.includes(form.newIntention)) db.intentions.push(form.newIntention);
      if (creating) db.records.push(record);
      else db.records = db.records.map((x) => (x.id === record.id ? record : x));
    });
  } catch (err) { return status(err.message); }
  dirty = false;
  if (creating) {
    creating = false;
    $("c-situation").value = record.situationId;
    renderList();
    const i = list.findIndex((x) => x.id === record.id);
    if (i >= 0) showRecord(i);
    return status("已新增。");
  }
  // Keep the current list (the record may no longer match the filters).
  list[index] = record;
  paintList();
  if (!approve) { showRecord(index); return status("已儲存。"); }
  const next = list.findIndex((x, i) => i > index && !recordAt(i)?.reviewed);
  const wrap = next >= 0 ? next : list.findIndex((x, i) => i < index && !recordAt(i)?.reviewed);
  if (wrap >= 0) { showRecord(wrap); status("已核准上一筆。"); }
  else { showRecord(index); status("已核准。這個列表沒有待審核的語料了。"); }
}

async function remove() {
  const r = recordAt(index);
  if (!r) return;
  const last = !state.db.records.some((x) => x.id !== r.id && x.situationId === r.situationId);
  if (!window.confirm(last ? "這是此情境的最後一筆，刪除後情境也會一併刪除。確定？" : "刪除這筆語料？")) return;
  try {
    await saveDb((db) => {
      db.records = db.records.filter((x) => x.id !== r.id);
      if (last) db.situations = db.situations.filter((s) => s.id !== r.situationId);
    });
  } catch (err) { return status(err.message); }
  dirty = false;
  const at = index;
  list.splice(at, 1);
  paintList();
  index = -1;
  if (list.length) showRecord(Math.min(at, list.length - 1));
  else showListView();
  status("已刪除。");
}

function openWith(filters) {
  if (!showView("corpus")) return false;
  for (const id of ["c-situation", "c-intention", "c-channel", "c-review", "c-search"]) $(id).value = filters[id] ?? "";
  renderList();
  return true;
}
views.corpus = {
  open() {
    if (dirty) return;
    showListView();
    status("");
  },
  leave() {
    if (dirty && !confirmDiscard()) return false;
    dirty = false;
  },
  dirty: () => dirty,
  // From the practice card's 「編輯」.
  openRecord(id) {
    if (!openWith({})) return;
    const i = list.findIndex((r) => r.id === id);
    if (i >= 0) showRecord(i);
  },
  // From 新增情境 after generating, or the practice view's empty state: review the first waiting record.
  openPending(situationId = "") {
    if (!openWith({ "c-situation": situationId, "c-review": "pending" })) return;
    if (list.length) showRecord(0);
  },
};
["c-situation", "c-intention", "c-channel", "c-review"].forEach((id) => { $(id).onchange = renderList; });
$("c-search").oninput = renderList;
$("c-add").onclick = showNew;
$("c-back").onclick = () => { if (!dirty || confirmDiscard()) showListView(); };
$("c-prev").onclick = () => showRecord(index - 1);
$("c-next").onclick = () => showRecord(index + 1);
$("c-record").onsubmit = (e) => { e.preventDefault(); save(); };
$("r-approve").onclick = () => save({ approve: true });
$("c-record").addEventListener("input", () => { dirty = true; });
$("c-record").addEventListener("change", () => { dirty = true; });
$("r-situation-pick").onchange = () => {
  const s = situationOf($("r-situation-pick").value);
  $("r-title").value = s?.title ?? "";
  $("r-description").value = s?.description ?? "";
};
$("r-intention").onchange = () => {
  const adding = $("r-intention").value === NEW_LABEL;
  $("r-new-intention").hidden = !adding;
  if (adding) $("r-new-intention").focus();
};
$("r-delete").onclick = remove;
$("r-play").onclick = () => { const text = $("r-reply").value.trim(); if (text) speak(text, 1, list[index]?.id || "new", status); };
document.addEventListener("keydown", (e) => {
  if ($("corpus").hidden || $("c-record").hidden || creating || e.ctrlKey || e.altKey || e.metaKey || e.target.closest?.("input,textarea,select")) return;
  if (e.key === "ArrowLeft") showRecord(index - 1);
  else if (e.key === "ArrowRight") showRecord(index + 1);
});
