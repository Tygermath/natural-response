import assert from "node:assert/strict";
import test from "node:test";

// Minimal browser stand-ins.
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { createStorage, connectGist, setSettings, getSettings, GIST_FILE } = await import("../public/storage.mjs");

// A fake GitHub Gist API holding one gist in memory.
function fakeGitHub() {
  const gists = new Map();
  let fail = false;
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fetchImpl = async (url, { method = "GET", body } = {}) => {
    if (fail) throw new TypeError("network down");
    const path = url.replace("https://api.github.com", "");
    if (method === "GET" && path.startsWith("/gists?")) return reply(200, [...gists.values()]);
    if (method === "POST" && path === "/gists") { const g = { id: "g" + (gists.size + 1), files: Object.fromEntries(Object.entries(JSON.parse(body).files).map(([n, f]) => [n, { content: f.content }])) }; gists.set(g.id, g); return reply(201, g); }
    const id = path.split("/")[2], g = gists.get(id);
    if (!g) return reply(404, {});
    if (method === "GET") return reply(200, g);
    if (method === "PATCH") { for (const [n, f] of Object.entries(JSON.parse(body).files)) g.files[n] = { content: f.content }; return reply(200, g); }
  };
  return { fetchImpl, gists, setFail: (v) => { fail = v; } };
}
const remoteDb = (gh) => JSON.parse([...gh.gists.values()][0].files[GIST_FILE].content);
const sample = { rev: 0, situations: [{ id: "s", title: "t", description: "d" }], records: [{ id: "r", situationId: "s", intention: "知悉", channel: "群組訊息", reply: "Got it.", chunks: ["got it"] }] };

test("without sync, data stays in localStorage", async () => {
  store.clear();
  const s = createStorage({ fetchImpl: async () => { throw new Error("must not call"); } });
  const db = await s.load();
  assert.equal(db.records.length, 0);
  const saved = await s.save(sample, db.rev);
  assert.equal(saved.rev, 1);
  assert.equal((await s.load()).records.length, 1);
});

test("connect creates a gist once; a second device finds it and downloads", async () => {
  store.clear();
  const gh = fakeGitHub();
  const first = await connectGist("t", { ...sample, rev: 1 }, gh.fetchImpl);
  assert.equal(first.created, true);
  const second = await connectGist("t", {}, gh.fetchImpl);
  assert.deepEqual(second, { gistId: first.gistId, created: false });
  setSettings({ githubToken: "t", gistId: second.gistId });
  const db = await createStorage({ fetchImpl: gh.fetchImpl }).load();
  assert.equal(db.records.length, 1);
});

test("saves upload; a stale device gets a conflict; offline edits upload later", async () => {
  store.clear();
  const gh = fakeGitHub();
  const { gistId } = await connectGist("t", { ...sample, rev: 1 }, gh.fetchImpl);
  setSettings({ githubToken: "t", gistId });
  const phone = createStorage({ fetchImpl: gh.fetchImpl });
  const db = await phone.load();
  const saved = await phone.save({ ...db, records: [] }, db.rev);
  assert.equal(remoteDb(gh).rev, 2);
  // Another device still at rev 1 must not overwrite rev 2.
  await assert.rejects(phone.save(db, 1), /另一台裝置/);
  // Offline: saved locally, uploaded on the next load.
  gh.setFail(true);
  const offline = await phone.save({ ...saved, records: sample.records }, saved.rev);
  assert.equal(offline.rev, 3);
  assert.match(phone.note(), /尚未同步/);
  assert.equal(remoteDb(gh).rev, 2);
  gh.setFail(false);
  await phone.load();
  assert.equal(remoteDb(gh).rev, 3);
  assert.equal(getSettings().gistId, gistId);
});
