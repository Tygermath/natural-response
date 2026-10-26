// 新增情境: the user gives a situation and one or more 回應目的. AI writes replies for every
// 目的 × every 溝通形式, and they go straight into the corpus as 待審核 for the user to review.
import { $, state, saveDb, situationOf, fillSelect, confirmDiscard, views } from "./app.mjs";
import { uid, splitChunks } from "./model.mjs";
import { generate as askClaude } from "./ai.mjs";

let busy = false, fieldsDirty = false, lastSituationId = "";
const status = (t) => { $("g-status").textContent = t; };
const target = () => situationOf($("g-target").value) || null;
const checked = () => [...$("g-intentions").querySelectorAll("input:checked")].map((x) => x.value);
let extraIntentions = []; // typed in here, saved to the list when records are saved

function renderChips(keep) {
  const values = [...new Set([...state.db.intentions, ...extraIntentions])];
  $("g-intentions").replaceChildren(...values.map((v) => {
    const label = Object.assign(document.createElement("label"), { className: "chip" });
    const input = Object.assign(document.createElement("input"), { type: "checkbox", value: v, checked: keep.includes(v) });
    input.onchange = updatePlan;
    label.append(input, v);
    return label;
  }));
}
function refresh() {
  fillSelect($("g-target"), [["", "＋ 新情境 New situation"], ...state.db.situations.map((s) => [s.id, s.title || "（未命名 Untitled）"])]);
  renderChips(checked());
  updateTarget();
  updatePlan();
}
function updateTarget() {
  const s = target();
  $("g-new-fields").hidden = !!s;
  $("g-existing").hidden = !s;
  if (s) $("g-existing").textContent = s.description + "\n（已有 " + state.db.records.filter((r) => r.situationId === s.id).length + " 筆）";
}
function updatePlan() {
  const purposes = checked().length, forms = state.db.channels.length, per = Number($("g-per").value);
  $("g-plan").textContent = purposes
    ? `${purposes} 個回應目的 × ${forms} 種溝通形式 × ${per} 句 = 共 ${purposes * forms * per} 句　${purposes} intentions × ${forms} channels × ${per} = ${purposes * forms * per} replies`
    : `每個回應目的會依 ${forms} 種溝通形式各產生回應。Each intention gets replies for all ${forms} channels: ${state.db.channels.join(", ")}.`;
}
function addIntention() {
  const value = $("g-new-intention").value.trim();
  if (!value) return;
  if (!state.db.intentions.includes(value) && !extraIntentions.includes(value)) extraIntentions.push(value);
  renderChips([...checked(), value]);
  $("g-new-intention").value = "";
  updatePlan();
}

async function generate() {
  if (busy) return;
  const s = target();
  const title = s ? s.title : $("g-title").value.trim();
  const description = s ? s.description : $("g-description").value.trim();
  const intentions = checked();
  if (!title) return status("請填寫情境名稱。");
  if (!description) return status("請填寫情境說明。");
  if (!intentions.length) return status("請至少選一個回應目的。");
  busy = true;
  $("g-generate").disabled = true;
  $("g-generate").textContent = "產生中… Generating…";
  $("g-review-row").hidden = true;
  status("AI 正在撰寫，約需 10–60 秒。");
  try {
    const replies = await askClaude({
      title, situation: description, intentions, channels: state.db.channels, perCombo: Number($("g-per").value),
      existing: s ? state.db.records.filter((r) => r.situationId === s.id).map((r) => r.reply) : [],
    });
    const situationId = s ? s.id : uid();
    const now = Date.now();
    const records = replies.map((r, i) => ({ id: uid(), situationId, intention: r.intention, channel: r.channel, reply: r.reply, chunks: splitChunks(r.chunks), reviewed: false, mastered: false, createdAt: now + i }));
    if (!records.length) throw new Error("AI 沒有產生可用的回應，請再試一次。");
    await saveDb((db) => {
      if (!s) db.situations.push({ id: situationId, title, description, createdAt: now });
      for (const v of intentions) if (!db.intentions.includes(v)) db.intentions.push(v);
      db.records.push(...records);
    });
    extraIntentions = [];
    fieldsDirty = false;
    lastSituationId = situationId;
    $("g-title").value = "";
    $("g-description").value = "";
    refresh();
    $("g-target").value = situationId;
    updateTarget();
    status("已加入 " + records.length + " 筆待審核的語料。");
    $("g-review-row").hidden = false;
  } catch (err) {
    status(err.message);
  } finally {
    busy = false;
    $("g-generate").disabled = false;
    $("g-generate").replaceChildren("產生回應", Object.assign(document.createElement("span"), { className: "en", textContent: "Generate" }));
  }
}

views.create = {
  open() { refresh(); status(""); $("g-review-row").hidden = true; },
  leave() {
    if (fieldsDirty && !confirmDiscard()) return false;
    fieldsDirty = false;
    extraIntentions = [];
    $("g-title").value = "";
    $("g-description").value = "";
  },
  dirty: () => fieldsDirty,
};
$("g-target").onchange = updateTarget;
$("g-per").onchange = updatePlan;
$("g-title").oninput = $("g-description").oninput = () => { fieldsDirty = true; };
$("g-add-intention").onclick = addIntention;
$("g-new-intention").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addIntention(); } };
$("g-generate").onclick = generate;
$("g-review").onclick = () => views.corpus.openPending(lastSituationId);
