// Shared client state and helpers. Views import this; main.mjs wires them together.
import { valuesOf, UNSET, splitPhrases } from "./model.mjs";
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
let speechRun = 0; // bumped to stop a running sentence-by-sentence sequence
let voicesWaited = false; // wait for the voice list only once
window.speechSynthesis?.getVoices(); // phones load the list lazily; start loading early

// Reading speed, 0.8–1.5, remembered on this device.
export const RATE_MIN = 0.8, RATE_MAX = 1.5;
export function getRate() {
  let r = 1;
  try { r = Number(localStorage.getItem("nr-rate")) || 1; } catch {}
  return Math.min(RATE_MAX, Math.max(RATE_MIN, r));
}
export function setRate(r) {
  try { localStorage.setItem("nr-rate", String(r)); } catch {}
}

// events: { onend } is called when this reading finishes, fails or is interrupted.
export function speak(text, key = "", onError = () => {}, events = {}) {
  speechRun++;
  say(text, key, onError, { onend: events.onend, onstop: events.onend });
}
// events for this utterance: onstart, onend (finished), onstop (failed or interrupted).
function say(text, key, onError, events = {}) {
  const synth = window.speechSynthesis;
  if (!synth) return onError("此瀏覽器不支援朗讀。");
  synth.cancel();
  const voices = synth.getVoices();
  if (!voices.length && !voicesWaited) {
    // The list is not ready yet: speak once it arrives (or after 1 s with the default voice).
    let done = false;
    const retry = () => { if (!done) { done = true; voicesWaited = true; sayWith(synth, synth.getVoices(), text, key, onError, events); } };
    synth.addEventListener("voiceschanged", retry, { once: true });
    setTimeout(retry, 1000);
    return;
  }
  sayWith(synth, voices, text, key, onError, events);
}
function sayWith(synth, voices, text, key, onError, events) {
  const profiles = availableProfiles(voices);
  let profile = profiles.find((p) => p.id === profileByKey.get(key));
  if (!profile) {
    const pool = profiles.length > 1 ? profiles.filter((p) => p.id !== lastProfile) : profiles;
    profile = pool[Math.floor(Math.random() * pool.length)];
    if (key) profileByKey.set(key, profile.id);
  }
  lastProfile = profile.id;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = getRate();
  u.lang = profile.lang;
  if (profile.voice) u.voice = profile.voice;
  u.onstart = () => events.onstart?.();
  u.onend = () => events.onend?.();
  u.onerror = (e) => {
    events.onstop?.();
    if (!["interrupted", "canceled"].includes(e.error)) onError("播放失敗，請再試一次。");
  };
  synth.speak(u);
}

// 逐句跟述: reads one sentence, then stays silent as long as that sentence took, so the learner
// can repeat it; then the next sentence, until the last. Calls onStep(index, total, "speak" | "repeat")
// and onDone() at the end. Any other speech, stopAudio() or a new call stops it.
export function shadow(text, key, { onStep = () => {}, onDone = () => {}, onError = () => {} } = {}) {
  const run = ++speechRun;
  const sentences = splitPhrases(text);
  const later = (fn, ms) => setTimeout(() => { if (run === speechRun) fn(); }, ms);
  let i = 0;
  // Per sentence: read it → silence 0.8 × its length to recall it → beep → silence as long as
  // the sentence (at least 0.8 s) to repeat it → next sentence.
  const next = () => {
    if (run !== speechRun) return;
    if (i >= sentences.length) return onDone();
    const index = i, total = sentences.length;
    let startedAt = performance.now();
    onStep(index, total, "speak");
    say(sentences[index], key, onError, {
      onstart: () => { startedAt = performance.now(); },
      onend: () => {
        if (run !== speechRun) return;
        const duration = performance.now() - startedAt;
        onStep(index, total, "recall");
        later(() => {
          beep();
          onStep(index, total, "repeat");
          i++;
          later(next, Math.max(800, duration));
        }, 0.8 * duration);
      },
    });
  };
  next();
}
export const stopShadow = () => { speechRun++; };

// ---------- speech input ----------
const recognitionClass = () => window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => !!recognitionClass();
let listener = null;
// One recognition at a time; a new one can only start after the browser ended the previous one.
// onEnd(heard) tells whether any speech was recognised, so a silent stop can be explained.
export function listen({ onText, onState, onError, onEnd = () => {} }) {
  const Recognition = recognitionClass();
  if (!Recognition || listener) return false;
  // Cancelling speech output switches the phone's audio session; doing that right before the
  // microphone opens makes some phones end recognition at once (two beeps). Only cancel when needed.
  const synth = window.speechSynthesis;
  if (synth && (synth.speaking || synth.pending)) synth.cancel();
  const rec = new Recognition();
  const current = { rec, onState, stopping: false, heard: false, failed: false };
  listener = current;
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    const text = [...e.results].map((r) => r[0].transcript).join(" ").trim();
    if (text) current.heard = true;
    onText(text);
  };
  rec.onerror = (e) => { current.failed = true; if (!current.stopping) onError(e.error); };
  rec.onend = () => {
    if (listener === current) listener = null;
    onState("idle");
    if (!current.stopping && !current.failed) onEnd(current.heard);
  };
  try { rec.start(); } catch { listener = null; return false; }
  onState("listening");
  return true;
}
export const isListening = () => !!listener && !listener.stopping;
// Ends listening but keeps what was said (used when the user taps the button again).
export function finishListening() {
  if (!listener || listener.stopping) return;
  try { listener.rec.stop(); } catch { stopListening(); }
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
  speechRun++;
  window.speechSynthesis?.cancel();
}

// One shared AudioContext. Phones only let it make sound if it was created or resumed during a
// tap, so tap handlers call unlockAudio() before sounds that play later (the shadowing beep).
let audioCtx = null;
export function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    audioCtx ??= new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {}
  return audioCtx;
}
function playNotes(notes, volume) {
  const ctx = audioCtx || unlockAudio();
  if (!ctx) return;
  try {
    for (const [freq, offset, length] of notes) {
      const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime + 0.01 + offset;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(volume, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + length + 0.02);
    }
  } catch {}
}
export function tone(success) {
  playNotes(success ? [[523.25, 0, 0.12], [659.25, 0.13, 0.2]] : [[329.63, 0, 0.14], [246.94, 0.15, 0.22]], 0.1);
}
// Peak at 90% of full scale. Speech voices play at about full scale, and the browser gives
// pages no way to measure their actual level, so this approximates 90% of the voice's peak.
export function beep() {
  playNotes([[880, 0, 0.2]], 0.9);
}
