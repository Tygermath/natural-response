// Data model shared by the browser and the server.
//
// db = {
//   rev,                      // save counter, guards against overwriting newer data
//   intentions: [string],     // selectable intentions
//   channels: [string],       // selectable channels
//   situations: [{ id, title, description, createdAt }],
//   records: [{ id, situationId, intention, channel, reply, chunks: [string], reviewed, mastered, createdAt }]
// }
// One record = one combination of situation × intention × channel, with its own reply and chunks.
// AI-written records start with reviewed = false and are not practised until the user approves them.

export const DEFAULT_INTENTIONS = ["知悉 Acknowledge", "讚許 Praise", "糾正 Correct", "責備 Reprimand", "鼓勵 Encourage", "追問 Follow-up"];
export const DEFAULT_CHANNELS = ["群組訊息 Group chat", "口頭對話 Spoken", "正式書信 Formal writing"];

// Earlier label spellings → the bilingual labels used now.
const LABEL_UPGRADES = {
  "知悉": "知悉 Acknowledge", "讚許": "讚許 Praise", "糾正": "糾正 Correct", "責備": "責備 Reprimand", "鼓勵": "鼓勵 Encourage",
  "追問": "追問 Follow-up", "follow up": "追問 Follow-up", "說明做法": "說明做法 Explain the plan",
  "群組訊息": "群組訊息 Group chat", "chat group": "群組訊息 Group chat",
  "口頭對話": "口頭對話 Spoken", "natural conversation": "口頭對話 Spoken",
  "正式書信": "正式書信 Formal writing", "formal text": "正式書信 Formal writing",
};
const upgrade = (label) => LABEL_UPGRADES[label] ?? label;

export function uid() {
  return globalThis.crypto?.randomUUID?.() ?? "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}
const str = (v) => (typeof v === "string" ? v.trim() : "");
const time = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : Date.now());
function cleanList(value, fallback) {
  const list = Array.isArray(value) ? [...new Set(value.map(str).filter(Boolean).map(upgrade))] : [];
  return list.length ? list : fallback.slice();
}
export function splitChunks(value) {
  const list = Array.isArray(value) ? value.map(str) : String(value ?? "").split(/[;；\n]/).map(str);
  return [...new Set(list.filter(Boolean))];
}

export function emptyDb() {
  return { rev: 0, intentions: DEFAULT_INTENTIONS.slice(), channels: DEFAULT_CHANNELS.slice(), situations: [], records: [] };
}

// Accepts this app's format, plus the two older export formats for one-time import:
// {items:[{title, need, replies:[{keyword, text, mastered}]}]} and {version:2, items:[{title, situation, replies:[{intention, channel, text, chunks}]}]}.
export function normalizeDb(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const db = { rev: Number(src.rev) || 0, intentions: cleanList(src.intentions, DEFAULT_INTENTIONS), channels: cleanList(src.channels, DEFAULT_CHANNELS), situations: [], records: [] };
  if (Array.isArray(src.situations)) {
    const ids = new Set();
    for (const s of src.situations) {
      if (!s || typeof s !== "object") continue;
      const id = str(s.id) || uid();
      if (ids.has(id)) continue;
      ids.add(id);
      db.situations.push({ id, title: str(s.title), description: str(s.description), createdAt: time(s.createdAt) });
    }
    for (const r of Array.isArray(src.records) ? src.records : []) {
      if (!r || typeof r !== "object" || !ids.has(r.situationId)) continue;
      db.records.push(cleanRecord(r, r.situationId));
    }
    return db;
  }
  const legacy = src.version !== 2;
  for (const item of Array.isArray(src.items) ? src.items : []) {
    if (!item || typeof item !== "object") continue;
    const id = str(item.id) || uid();
    db.situations.push({ id, title: str(item.title), description: str(legacy ? item.need : item.situation), createdAt: Date.now() });
    for (const r of Array.isArray(item.replies) ? item.replies : []) {
      if (!r || typeof r !== "object" || !str(r.text)) continue;
      db.records.push(cleanRecord({
        id: r.id, intention: r.intention, channel: str(r.channel) || (legacy ? "口頭對話 Spoken" : ""),
        reply: r.text, chunks: legacy ? r.keyword : r.chunks, mastered: r.mastered,
      }, id));
    }
  }
  return db;
}
function cleanRecord(r, situationId) {
  return { id: str(r.id) || uid(), situationId, intention: upgrade(str(r.intention)), channel: upgrade(str(r.channel)), reply: str(r.reply), chunks: splitChunks(r.chunks), reviewed: r.reviewed !== false, mastered: r.mastered === true, createdAt: time(r.createdAt) };
}

// Configured values plus any value already used by a record ("" means unset).
export function valuesOf(db, field) {
  const listed = field === "intention" ? db.intentions : db.channels;
  const used = db.records.map((r) => r[field]);
  const all = [...listed, ...new Set(used.filter((v) => v && !listed.includes(v)))];
  return used.includes("") ? [...all, ""] : all;
}

export const UNSET = "__unset__";
const matches = (value, filter) => !filter || (filter === UNSET ? value === "" : value === filter);
// review: "" (all), "pending" or "approved".
export function filterRecords(db, { situationId = "", intention = "", channel = "", review = "", unmastered = false, search = "" } = {}) {
  const q = search.trim().toLowerCase();
  const situations = new Map(db.situations.map((s) => [s.id, s]));
  return db.records.filter((r) => {
    if (situationId && r.situationId !== situationId) return false;
    if (!matches(r.intention, intention) || !matches(r.channel, channel)) return false;
    if (review && r.reviewed !== (review === "approved")) return false;
    if (unmastered && r.mastered) return false;
    if (!q) return true;
    const s = situations.get(r.situationId);
    return [s?.title, s?.description, r.reply, ...r.chunks].some((x) => x?.toLowerCase().includes(q));
  });
}

export function validateRecord(r) {
  if (!r.intention) return "請選擇回應目的。";
  if (!r.channel) return "請選擇溝通形式。";
  if (!r.reply) return "請填寫英文回應。";
  if (!/[a-z]/i.test(r.reply) || /[\u3400-\u9fff]/.test(r.reply)) return "回應只能是英文。";
  if (!r.chunks.length) return "至少填一個語塊。";
  return "";
}
// Two records with the same key would produce indistinguishable flashcards.
export function recordKey(r) {
  return [r.situationId, r.intention, r.channel, ...r.chunks.map(normalize).sort()].join("\u0000");
}

export function normalize(text) {
  return String(text ?? "").toLowerCase().replace(/[’‘`]/g, "'")
    .replace(/\bcan't\b/g, "cannot").replace(/\bwon't\b/g, "will not").replace(/n't\b/g, " not")
    .replace(/\bi'm\b/g, "i am").replace(/\blet's\b/g, "let us").replace(/\b(it|that|what|there|he|she)'s\b/g, "$1 is")
    .replace(/'re\b/g, " are").replace(/'ve\b/g, " have").replace(/'ll\b/g, " will").replace(/'d\b/g, " would")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
// "..." inside a chunk stands for any words, e.g. "not only ... but also".
const parts = (chunk) => String(chunk).split(/\.{2,}|…/).map((p) => p.trim()).filter(Boolean);
export function hasChunk(answer, chunk) {
  const words = " " + normalize(answer) + " ";
  const list = parts(chunk).map(normalize).filter(Boolean);
  let from = 0;
  for (const p of list) {
    const at = words.indexOf(" " + p + " ", from);
    if (at < 0) return false;
    from = at + p.length + 1;
  }
  return list.length > 0;
}
export function compare(answer, reply, chunks) {
  return { exact: normalize(answer) === normalize(reply), chunks: chunks.map((chunk) => ({ chunk, hit: hasChunk(answer, chunk) })) };
}
// Merged [start, end) character ranges of chunk parts inside the reply, for highlighting.
export function chunkRanges(text, chunks) {
  const ranges = [];
  for (const chunk of chunks) for (const p of parts(chunk)) {
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]").replace(/\s+/g, "\\s+");
    const re = new RegExp((/^\w/.test(p) ? "\\b" : "") + escaped + (/\w$/.test(p) ? "\\b" : ""), "gi");
    for (const m of text.matchAll(re)) ranges.push([m.index, m.index + m[0].length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}
