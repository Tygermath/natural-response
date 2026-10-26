// Shared client state and helpers. Views import this; main.mjs wires them together.
import { valuesOf, UNSET } from "./model.mjs";
import { createStorage } from "./storage.mjs";
import { availableProfiles } from "./voices.mjs";

export const $ = (id) => document.getElementById(id);
export const state = { db: null };

// ---------- data ----------
export const storage = createStorage();
export async function loadDb() {
  state.db = await storage.load();
  updateBadge();
  showSyncNote();
}
function showSyncNote() {
  $("load-status").textContent = storage.note();
}
export const pendingCount = () => state.db.records.filter((r) => !r.reviewed).length;
function updateBadge() {
  const n = pendingCount();
  $("pending-badge").hidden = !n;
  $("pending-badge").textContent = n;
  $("pending-badge").title = n + " 筆待審核";
}
// mutate(copy) edits a copy of the database; the copy becomes current only after the server saved it.
export async function saveDb(mutate) {
  const next = structuredClone(state.db);
  mutate(next);
  state.db = await storage.save(next, state.db.rev);
  updateBadge();
  showSyncNote();
}
export const situationOf = (id) => state.db.situations.find((s) => s.id === id);

// ---------- form helpers ----------
export function fillSelect(select, options) {
  const previous = select.value;
  select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
  select.value = options.some((o) => o[0] === previous) ? previous : options[0]?.[0] ?? "";
}
export const valueLabel = (v) => v || "（未設定 Unset）";
export const filterOptions = (field, allLabel) => [["", allLabel], ...valuesOf(state.db, field).map((v) => [v || UNSET, valueLabel(v)])];
export function situationOptions(allLabel) {
  const counts = new Map();
  for (const r of state.db.records) counts.set(r.situationId, (counts.get(r.situationId) || 0) + 1);
  return [["", allLabel], ...state.db.situations.map((s) => [s.id, (s.title || "（未命名 Untitled）") + "（" + (counts.get(s.id) || 0) + "）"])];
}
// Select for a record's intention/channel: configured values plus the record's own value.
export const NEW_LABEL = "__new__";
export function choiceOptions(field, value, allowNew = false) {
  const values = valuesOf(state.db, field).filter(Boolean);
  if (value && !values.includes(value)) values.push(value);
  return [...(value ? [] : [["", "請選擇 Select"]]), ...values.map((v) => [v, v]), ...(allowNew ? [[NEW_LABEL, "＋ 新增… New…"]] : [])];
}
export const confirmDiscard = () => window.confirm("有未儲存的修改，要放棄嗎？");

// ---------- views ----------
// Each view registers { open(), leave() -> false to stay, dirty() }.
export const views = {};
let current = "";
export const currentView = () => current;
export function showView(name) {
  if (name !== current && views[current]?.leave?.() === false) return false;
  stopAudio();
  current = name;
  for (const n of Object.keys(views)) $(n).hidden = n !== name;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  views[name].open();
  return true;
}
export const hasUnsavedEdits = () => Object.values(views).some((v) => v.dirty?.());

// ---------- speech output ----------
// Four voices (US/UK × female/male, see voices.mjs) rotate between cards; a card keeps its voice.
const profileByKey = new Map();
let lastProfile = "";
window.speechSynthesis?.getVoices(); // phones load the list lazily; start loading early
export function speak(text, rate = 1, key = "", onError = () => {}) {
  const synth = window.speechSynthesis;
  if (!synth) return onError("此瀏覽器不支援朗讀。");
  synth.cancel();
  const voices = synth.getVoices();
  if (!voices.length) {
    // The list is not ready yet: speak once it arrives (or after 1 s with the default voice).
    let done = false;
    const retry = () => { if (!done) { done = true; speakWith(synth, synth.getVoices(), text, rate, key, onError); } };
    synth.addEventListener("voiceschanged", retry, { once: true });
    setTimeout(retry, 1000);
    return;
  }
  speakWith(synth, voices, text, rate, key, onError);
}
function speakWith(synth, voices, text, rate, key, onError) {
  const profiles = availableProfiles(voices);
  let profile = profiles.find((p) => p.id === profileByKey.get(key));
  if (!profile) {
    const pool = profiles.length > 1 ? profiles.filter((p) => p.id !== lastProfile) : profiles;
    profile = pool[Math.floor(Math.random() * pool.length)];
    if (key) profileByKey.set(key, profile.id);
  }
  lastProfile = profile.id;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  u.lang = profile.lang;
  if (profile.voice) u.voice = profile.voice;
  u.onerror = (e) => { if (!["interrupted", "canceled"].includes(e.error)) onError("播放失敗，請再試一次。"); };
  synth.speak(u);
}

// ---------- speech input ----------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!Recognition;
let listener = null;
// One recognition at a time; a new one can only start after the browser ended the previous one.
export function listen({ onText, onState, onError }) {
  if (!Recognition || listener) return false;
  const rec = new Recognition();
  listener = { rec, onState, stopping: false };
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => onText([...e.results].map((r) => r[0].transcript).join(" "));
  rec.onerror = (e) => { if (!listener?.stopping) onError(e.error); };
  rec.onend = () => { listener = null; onState("idle"); };
  try { rec.start(); } catch { listener = null; return false; }
  onState("listening");
  return true;
}
export function stopListening() {
  if (!listener || listener.stopping) return;
  const current = listener;
  current.stopping = true;
  current.onState("stopping");
  // Some browsers never send "end" after abort; release the lock after a while anyway.
  const release = () => { if (listener === current) { listener = null; current.onState("idle"); } };
  try { current.rec.abort(); } catch { release(); }
  setTimeout(release, 1500);
}
export function stopAudio() {
  stopListening();
  window.speechSynthesis?.cancel();
}

export function tone(success) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const notes = success ? [[523.25, 0, 0.12], [659.25, 0.13, 0.2]] : [[329.63, 0, 0.14], [246.94, 0.15, 0.22]];
    for (const [freq, offset, length] of notes) {
      const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime + 0.01 + offset;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.1, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + length + 0.02);
    }
    setTimeout(() => ctx.close(), 700);
  } catch {}
}
