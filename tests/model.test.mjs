import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDb, filterRecords, valuesOf, UNSET, compare, hasChunk, chunkRanges, validateRecord, recordKey } from "../public/model.mjs";

const oldExport = { items: [{ id: "s1", title: "抽籤", need: "上課抽名字", intent: "x", method: "name", replies: [
  { id: "r1", keyword: "draw a name", text: "I'm going to draw a name.", mastered: true },
  { id: "r2", keyword: "pick someone; asking for volunteers", text: "I'll pick someone instead of asking for volunteers." },
] }], total: 3 };

test("old export imports as situations + records without losing anything", () => {
  const db = normalizeDb(oldExport);
  assert.deepEqual(db.situations.map((s) => [s.id, s.title, s.description]), [["s1", "抽籤", "上課抽名字"]]);
  assert.equal(db.records.length, 2);
  assert.deepEqual(db.records[1].chunks, ["pick someone", "asking for volunteers"]);
  assert.equal(db.records[0].mastered, true);
  assert.equal(db.records[0].channel, "口頭對話 Spoken");
  assert.equal(db.records[0].reviewed, true, "imported records count as reviewed");
  assert.equal(db.records[0].intention, "");
  assert.equal(db.records[0].situationId, "s1");
});

test("normalizeDb is stable on its own output and drops orphan records", () => {
  const db = normalizeDb(oldExport);
  assert.deepEqual(normalizeDb(structuredClone(db)), db);
  const orphan = { ...db, records: [...db.records, { ...db.records[0], id: "x", situationId: "missing" }] };
  assert.equal(normalizeDb(orphan).records.length, 2);
});

test("filters by situation, intention, channel, unset value, mastery and search", () => {
  const db = normalizeDb({ situations: [{ id: "a", title: "Eddie Woo", description: "x" }], records: [
    { id: "1", situationId: "a", intention: "知悉", channel: "chat group", reply: "Got it.", chunks: ["got it"] },
    { id: "2", situationId: "a", intention: "讚許", channel: "chat group", reply: "Great choice!", chunks: ["great choice"], mastered: true },
    { id: "3", situationId: "a", intention: "", channel: "formal text", reply: "Noted.", chunks: ["noted"], reviewed: false },
  ] });
  const ids = (f) => filterRecords(db, f).map((r) => r.id);
  assert.deepEqual(ids({ channel: "群組訊息 Group chat" }), ["1", "2"]);
  assert.deepEqual(ids({ intention: UNSET }), ["3"]);
  assert.deepEqual(ids({ unmastered: true }), ["1", "3"]);
  assert.deepEqual(ids({ search: "great" }), ["2"]);
  assert.deepEqual(ids({ review: "pending" }), ["3"]);
  assert.deepEqual(ids({ review: "approved" }), ["1", "2"]);
  assert.deepEqual(ids({ search: "eddie" }), ["1", "2", "3"]);
  assert.ok(valuesOf(db, "intention").includes(""));
});

test("compare treats contractions as equal and checks chunks with ... gaps", () => {
  assert.equal(compare("I will pick someone at random", "I’ll pick someone at random", []).exact, true);
  const r = compare("not only fast but also kind", "He is not only smart but also kind.", ["not only ... but also", "smart"]);
  assert.equal(r.exact, false);
  assert.deepEqual(r.chunks.map((c) => c.hit), [true, false]);
  assert.equal(hasChunk("draw a named card", "draw a name"), false);
});

test("chunk ranges respect word boundaries and merge overlaps", () => {
  assert.deepEqual(chunkRanges("Draw a name now", ["draw a", "a name"]), [[0, 11]]);
  assert.deepEqual(chunkRanges("A banana", ["an"]), []);
  assert.deepEqual(chunkRanges("I’m going to pick", ["I'm going to"]), [[0, 12]]);
});

test("validateRecord and recordKey", () => {
  const r = { situationId: "a", intention: "知悉", channel: "chat group", reply: "Got it.", chunks: ["got it"] };
  assert.equal(validateRecord(r), "");
  assert.match(validateRecord({ ...r, intention: "" }), /回應目的/);
  assert.match(validateRecord({ ...r, reply: "好的" }), /英文/);
  assert.match(validateRecord({ ...r, chunks: [] }), /語塊/);
  assert.equal(recordKey(r), recordKey({ ...r, reply: "Got it, thanks.", chunks: ["Got it"] }));
  assert.notEqual(recordKey(r), recordKey({ ...r, chunks: ["thanks"] }));
});

test("earlier label spellings become bilingual labels", () => {
  const db = normalizeDb({ intentions: ["讚許", "說明做法", "安撫 Reassure"], channels: ["chat group", "口頭對話"], situations: [{ id: "s", title: "t", description: "d" }],
    records: [{ id: "r", situationId: "s", intention: "說明做法", channel: "natural conversation", reply: "OK.", chunks: ["ok"] }] });
  assert.deepEqual(db.intentions, ["讚許 Praise", "說明做法 Explain the plan", "安撫 Reassure"]);
  assert.deepEqual(db.channels, ["群組訊息 Group chat", "口頭對話 Spoken"]);
  assert.equal(db.records[0].intention, "說明做法 Explain the plan");
  assert.equal(db.records[0].channel, "口頭對話 Spoken");
});
