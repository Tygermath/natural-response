// Where the database lives. Every device keeps a copy in localStorage; when a GitHub token is set,
// the same JSON is kept in a secret Gist so phone, tablet and computer share one corpus.
// Gist revisions double as the backup history.
import { emptyDb, normalizeDb } from "./model.mjs";

const DB_KEY = "nr-db";
const SETTINGS_KEY = "nr-settings";
const UNSYNCED_KEY = "nr-unsynced";
export const GIST_FILE = "natural-response-corpus.json";
const API = "https://api.github.com";

export class ConflictError extends Error {}

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// { anthropicKey, githubToken, gistId } — stored only on this device.
export function getSettings() {
  return { anthropicKey: "", githubToken: "", gistId: "", ...read(SETTINGS_KEY) };
}
export function setSettings(patch) {
  write(SETTINGS_KEY, { ...getSettings(), ...patch });
}

async function github(path, { method = "GET", body, token, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(API + path, {
    method,
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body && JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 401) throw new Error("GitHub token 無效或已過期。");
  if (res.status === 403 || res.status === 404) throw new Error("GitHub token 沒有 Gist 權限，或找不到資料。");
  if (!res.ok) throw new Error("GitHub 錯誤（" + res.status + "）。");
  return res.json();
}
async function readGist(token, gistId, fetchImpl) {
  const gist = await github("/gists/" + gistId, { token, fetchImpl });
  const file = gist.files?.[GIST_FILE];
  if (!file) throw new Error("Gist 中找不到資料檔。");
  // Large files are truncated in the listing; fetch the raw content then.
  const content = file.truncated ? await (await fetchImpl(file.raw_url)).text() : file.content;
  return normalizeDb(JSON.parse(content));
}

// Finds this app's Gist in the user's account, or creates one holding `db`.
export async function connectGist(token, db, fetchImpl = fetch) {
  for (let page = 1; page <= 10; page++) {
    const gists = await github(`/gists?per_page=100&page=${page}`, { token, fetchImpl });
    const found = gists.find((g) => g.files?.[GIST_FILE]);
    if (found) return { gistId: found.id, created: false };
    if (gists.length < 100) break;
  }
  const created = await github("/gists", { method: "POST", token, fetchImpl, body: { description: "Natural Response corpus", public: false, files: { [GIST_FILE]: { content: JSON.stringify(db, null, 2) } } } });
  return { gistId: created.id, created: true };
}

export function createStorage({ fetchImpl = fetch } = {}) {
  const sync = () => { const s = getSettings(); return s.githubToken && s.gistId ? s : null; };
  let note = "";

  // Loads the local copy, then the Gist when sync is on. The higher rev wins; local edits that
  // could not be uploaded earlier are uploaded now.
  async function load() {
    let db = normalizeDb(read(DB_KEY) ?? emptyDb());
    const s = sync();
    note = "";
    if (!s) return db;
    try {
      const remote = await readGist(s.githubToken, s.gistId, fetchImpl);
      if (read(UNSYNCED_KEY) && db.rev >= remote.rev) {
        await upload(s, db);
      } else if (remote.rev >= db.rev) {
        db = remote;
        write(DB_KEY, db);
        localStorage.removeItem(UNSYNCED_KEY);
      }
    } catch (err) {
      note = "無法連線到 GitHub，使用本機資料：" + err.message;
    }
    return db;
  }

  async function upload(s, db) {
    await github("/gists/" + s.gistId, { method: "PATCH", token: s.githubToken, fetchImpl, body: { files: { [GIST_FILE]: { content: JSON.stringify(db, null, 2) } } } });
    localStorage.removeItem(UNSYNCED_KEY);
  }

  // Saves `next` as the version after baseRev. Throws ConflictError if another device saved first.
  async function save(next, baseRev) {
    const s = sync();
    if (s) {
      let remote = null;
      try { remote = await readGist(s.githubToken, s.gistId, fetchImpl); } catch (err) { note = "未同步：" + err.message; }
      if (remote && remote.rev > baseRev) throw new ConflictError("另一台裝置已更新資料，請重新整理頁面後再改。");
    }
    const db = { ...normalizeDb(next), rev: baseRev + 1 };
    write(DB_KEY, db);
    if (s) {
      try { await upload(s, db); note = ""; } catch (err) {
        write(UNSYNCED_KEY, true);
        note = "已存在本機，尚未同步到 GitHub：" + err.message;
      }
    }
    return db;
  }

  return { load, save, note: () => note, syncing: () => !!sync() };
}
