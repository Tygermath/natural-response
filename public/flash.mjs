import { $, state, saveDb, situationOf, fillSelect, valueLabel, filterOptions, situationOptions, views, showView, speak, stopAudio, listen, stopListening, isListening, finishListening, canListen, tone, pendingCount } from "./app.mjs";
import { filterRecords, compare, chunkRanges } from "./model.mjs";

let deck = [], index = 0, flipped = false;
const card = () => deck[index];
const status = (t) => { $("flash-status").textContent = t; };

function refreshFilters() {
  fillSelect($("f-situation"), situationOptions("全部情境 All"));
  fillSelect($("f-intention"), filterOptions("intention", "全部目的 All"));
  fillSelect($("f-channel"), filterOptions("channel", "全部形式 All"));
}
function deal() {
  stopAudio();
  const previous = card()?.id;
  // Records waiting for review are not practised.
  deck = filterRecords(state.db, { situationId: $("f-situation").value, intention: $("f-intention").value, channel: $("f-channel").value, review: "approved", unmastered: $("f-unmastered").checked });
  const order = $("f-order").value;
  if (order === "random") {
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    if (deck.length > 1 && deck[0].id === previous) [deck[0], deck[1]] = [deck[1], deck[0]];
  } else if (order === "newest") deck.sort((a, b) => b.createdAt - a.createdAt);
  index = 0;
  render();
}

function setFlipped(value) {
  flipped = value;
  $("flash-card").classList.toggle("flipped", value);
  $("flash-front").inert = value; $("flash-front").setAttribute("aria-hidden", String(value));
  $("flash-back").inert = !value; $("flash-back").setAttribute("aria-hidden", String(!value));
}
function renderReply(text, chunks) {
  const el = $("flash-reply");
  el.replaceChildren();
  let at = 0;
  for (const [start, end] of chunkRanges(text, chunks)) {
    el.append(text.slice(at, start));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(start, end);
    el.append(mark);
    at = end;
  }
  el.append(text.slice(at));
}
function render() {
  stopAudio();
  const r = card();
  $("flash-empty").hidden = !!r;
  $("flash-content").hidden = !r;
  if (!r) {
    const pending = pendingCount(), approved = state.db.records.length - pending;
    const [message, action] = !state.db.records.length ? ["還沒有語料。", "新增情境"]
      : !approved ? ["有 " + pending + " 筆語料待審核，審核後才會出現在練習中。", "去審核"]
      : ["沒有符合條件的卡片。", ""];
    $("flash-empty-message").textContent = message;
    $("flash-empty-action").textContent = action;
    $("flash-empty-action").hidden = !action;
    status("");
    return;
  }
  const s = situationOf(r.situationId);
  setFlipped(false);
  $("flash-position").textContent = index + 1 + " / " + deck.length;
  $("flash-intention").textContent = valueLabel(r.intention);
  $("flash-channel").textContent = valueLabel(r.channel);
  $("flash-title").textContent = s?.title || "";
  $("flash-description").textContent = s?.description || "";
  $("flash-chunks").replaceChildren(...r.chunks.map((c) => Object.assign(document.createElement("span"), { textContent: c })));
  $("flash-answer").value = "";
  $("flash-result").replaceChildren();
  $("flash-result").className = "";
  renderReply(r.reply, r.chunks);
  $("flash-mastered").checked = r.mastered;
  $("flash-prev").disabled = index === 0;
  $("flash-next").disabled = index === deck.length - 1;
  status("");
}
function go(step) {
  const next = index + step;
  if (next < 0) return status("已是第一張。");
  if (next >= deck.length) return status("已是最後一張。");
  index = next;
  render();
}
function flip() {
  if (!card()) return;
  stopAudio();
  setFlipped(!flipped);
}

function check() {
  const r = card();
  if (!r) return;
  const answer = $("flash-answer").value.trim(), out = $("flash-result");
  out.replaceChildren();
  if (!/[a-z]/i.test(answer)) { out.className = "miss"; out.textContent = "請先說或輸入英文。"; return; }
  stopAudio();
  const result = compare(answer, r.reply, r.chunks);
  const allChunks = result.chunks.every((c) => c.hit);
  out.className = result.exact ? "exact" : allChunks ? "partial" : "miss";
  out.append(Object.assign(document.createElement("strong"), { textContent: result.exact ? "與示範完全相同" : allChunks ? "語塊都用上了，句子與示範不同。" : "還沒用上所有語塊" }));
  if (!result.exact) for (const c of result.chunks) out.append(Object.assign(document.createElement("span"), { className: c.hit ? "hit" : "lost", textContent: (c.hit ? "✓ " : "✗ ") + c.chunk }));
  tone(result.exact);
}

const DICTATION_HINT = "也可以點文字框，用鍵盤上的麥克風（聽寫）輸入。Or tap the text box and use the keyboard's dictation.";
const MIC_ERRORS = {
  "not-allowed": "麥克風未獲允許：請在瀏覽器設定中允許此網站使用麥克風。",
  "service-not-allowed": "這個瀏覽器不允許語音辨識（例如 iPhone 需開啟「設定 → 一般 → 鍵盤 → 聽寫」）。",
  "no-speech": "沒有聽到聲音，請在提示音後再說話。",
  "audio-capture": "找不到可用的麥克風，或麥克風正被其他 app 使用。",
  network: "語音辨識需要網路連線。",
};
let micStartedAt = 0;
// Tap once to start, tap again to finish early. Repeated taps right after starting are ignored,
// so one touch can never start and immediately stop listening.
function mic() {
  if (flipped || !card()) return;
  if (!canListen()) return status("此瀏覽器不支援語音辨識。" + DICTATION_HINT);
  if (Date.now() - micStartedAt < 800) return;
  if (isListening()) return finishListening();
  micStartedAt = Date.now();
  $("flash-answer").value = "";
  $("flash-result").replaceChildren();
  status("");
  const button = $("flash-mic");
  const started = listen({
    onText: (text) => { $("flash-answer").value = text; },
    onState: (s) => {
      button.disabled = s === "stopping";
      button.classList.toggle("listening", s === "listening");
      button.setAttribute("aria-pressed", String(s === "listening"));
      const [zh, en] = s === "listening" ? ["聆聽中，點此結束", "Tap to stop"] : ["語音輸入", "Speak"];
      button.replaceChildren(zh, Object.assign(document.createElement("span"), { className: "en", textContent: en }));
    },
    onError: (code) => status((MIC_ERRORS[code] || "語音輸入中斷（" + code + "）。") + " " + DICTATION_HINT),
    onEnd: (heard) => { if (!heard) status("沒有辨識到內容，請在提示音後再說一次。" + DICTATION_HINT); },
  });
  if (!started) status("無法啟動麥克風。" + DICTATION_HINT);
}

async function setMastered() {
  const r = card();
  if (!r) return;
  const value = $("flash-mastered").checked;
  try {
    await saveDb((db) => { const x = db.records.find((y) => y.id === r.id); if (x) x.mastered = value; });
  } catch (err) {
    $("flash-mastered").checked = !value;
    return status(err.message);
  }
  r.mastered = value;
  if (value && $("f-unmastered").checked) {
    deck.splice(index, 1);
    index = Math.min(index, Math.max(0, deck.length - 1));
    render();
  }
}

// Tap on the card flips it; a horizontal swipe changes card. Controls inside the card are left alone.
function attachGestures() {
  const el = $("flash-card");
  const interactive = "button,input,textarea,select,label,a";
  let start = null, ignoreClickUntil = 0;
  el.addEventListener("pointerdown", (e) => { start = e.isPrimary && !e.target.closest(interactive) ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null; });
  el.addEventListener("pointerup", (e) => {
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { ignoreClickUntil = Date.now() + 500; go(dx < 0 ? 1 : -1); }
    else if (Math.hypot(dx, dy) > 15) ignoreClickUntil = Date.now() + 500;
  });
  el.addEventListener("pointercancel", () => { start = null; });
  el.addEventListener("click", (e) => { if (Date.now() >= ignoreClickUntil && !e.target.closest(interactive)) flip(); });
}

views.flash = {
  open() { refreshFilters(); deal(); },
};
["f-situation", "f-intention", "f-channel", "f-order", "f-unmastered"].forEach((id) => { $(id).onchange = deal; });
$("flash-reorder").onclick = deal;
$("flash-prev").onclick = () => go(-1);
$("flash-next").onclick = () => go(1);
$("flash-mic").onclick = mic;
$("flash-check").onclick = check;
$("flash-mastered").onchange = setMastered;
document.querySelectorAll("#flash .speech button").forEach((b) => {
  b.onclick = () => { const r = card(); if (r) { stopListening(); speak(r.reply, Number(b.dataset.rate), r.id, status); } };
});
$("flash-edit").onclick = () => { const r = card(); if (r) views.corpus.openRecord(r.id); };
$("flash-empty-action").onclick = () => (state.db.records.length ? views.corpus.openPending() : showView("create"));
document.addEventListener("keydown", (e) => {
  if ($("flash").hidden || !card() || e.repeat || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target.closest?.("input,textarea,select,button,a")) return;
  if (e.key === " ") { e.preventDefault(); flip(); }
  else if (e.key === "ArrowRight") go(1);
  else if (e.key === "ArrowLeft") go(-1);
});
attachGestures();
