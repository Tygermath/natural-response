import { $, state, saveDb, loadDb, views } from "./app.mjs";
import { normalizeDb } from "./model.mjs";
import { getSettings, setSettings, connectGist } from "./storage.mjs";

const lines = (text) => [...new Set(text.split("\n").map((x) => x.trim()).filter(Boolean))];

function renderSync() {
  const s = getSettings();
  const on = !!(s.githubToken && s.gistId);
  $("s-disconnect").hidden = !on;
  $("s-gist-link").hidden = !on;
  if (on) $("s-gist-link").href = "https://gist.github.com/" + s.gistId;
  $("s-github-token").placeholder = on ? "已連接 Connected（輸入新 token 可更換 enter a new token to replace）" : "github_pat_… / ghp_…";
  $("s-sync-status").textContent = on ? "已開啟同步。Syncing is on." : "未同步：資料只存在這個瀏覽器。Not syncing: data stays in this browser.";
}

views.settings = {
  open() {
    $("s-intentions").value = state.db.intentions.join("\n");
    $("s-channels").value = state.db.channels.join("\n");
    $("s-anthropic-key").value = "";
    $("s-anthropic-key").placeholder = getSettings().anthropicKey ? "已設定 Saved（輸入新 key 可更換 enter a new key to replace）" : "sk-ant-…";
    $("s-github-token").value = "";
    for (const id of ["s-lists-status", "s-key-status", "s-backup-status"]) $(id).textContent = "";
    renderSync();
  },
};

$("s-save-lists").onclick = async () => {
  const intentions = lines($("s-intentions").value), channels = lines($("s-channels").value);
  const out = $("s-lists-status");
  if (!intentions.length || !channels.length) { out.textContent = "兩個清單都至少要有一項。Both lists need at least one item."; return; }
  try {
    await saveDb((db) => { db.intentions = intentions; db.channels = channels; });
    out.textContent = "已儲存。Saved.";
  } catch (err) { out.textContent = err.message; }
};

$("s-save-key").onclick = () => {
  const key = $("s-anthropic-key").value.trim();
  if (!key) { $("s-key-status").textContent = "請輸入 API key。"; return; }
  setSettings({ anthropicKey: key });
  views.settings.open();
  $("s-key-status").textContent = "已儲存在這台裝置。Saved on this device.";
};

$("s-connect").onclick = async () => {
  const token = $("s-github-token").value.trim();
  if (!token) { $("s-sync-status").textContent = "請輸入 GitHub token。"; return; }
  $("s-connect").disabled = true;
  $("s-sync-status").textContent = "連接中… Connecting…";
  try {
    const { gistId, created } = await connectGist(token, state.db);
    setSettings({ githubToken: token, gistId });
    await loadDb();
    views.settings.open();
    $("s-sync-status").textContent = created
      ? "已在 GitHub 建立同步資料，其他裝置填入同一個 token 即可。Created; use the same token on your other devices."
      : "已連接並下載 " + state.db.records.length + " 筆。Connected.";
  } catch (err) {
    $("s-sync-status").textContent = err instanceof TypeError ? "無法連線到 GitHub。" : err.message;
  } finally {
    $("s-connect").disabled = false;
  }
};

$("s-disconnect").onclick = () => {
  if (!window.confirm("停止這台裝置的同步？資料仍保留在這個瀏覽器與 GitHub。")) return;
  setSettings({ githubToken: "", gistId: "" });
  renderSync();
};

$("s-export").onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state.db, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "natural-response-" + new Date().toISOString().slice(0, 10) + ".json" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

$("s-import").onclick = () => $("s-import-file").click();
$("s-import-file").onchange = async () => {
  const file = $("s-import-file").files[0];
  $("s-import-file").value = "";
  if (!file) return;
  const out = $("s-backup-status");
  let imported;
  try { imported = normalizeDb(JSON.parse(await file.text())); } catch { out.textContent = "檔案不是有效的 JSON。"; return; }
  if (!imported.records.length) { out.textContent = "檔案中沒有語料。"; return; }
  if (!window.confirm("把檔案中的 " + imported.records.length + " 筆加到語料庫？（已存在的同一筆會略過）")) return;
  try {
    // Merge: skip situations and records whose ids already exist.
    await saveDb((db) => {
      const sIds = new Set(db.situations.map((s) => s.id)), rIds = new Set(db.records.map((r) => r.id));
      db.situations.push(...imported.situations.filter((s) => !sIds.has(s.id)));
      db.records.push(...imported.records.filter((r) => !rIds.has(r.id)));
      db.intentions = [...new Set([...db.intentions, ...imported.intentions])];
      db.channels = [...new Set([...db.channels, ...imported.channels])];
    });
    out.textContent = "已匯入。目前共 " + state.db.records.length + " 筆。Imported.";
  } catch (err) { out.textContent = err.message; }
};

