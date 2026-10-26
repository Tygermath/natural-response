import { $, loadDb, showView, hasUnsavedEdits, stopAudio } from "./app.mjs";
import "./flash.mjs";
import "./corpus.mjs";
import "./create.mjs";
import "./settings.mjs";

document.querySelectorAll(".tab").forEach((t) => { t.onclick = () => showView(t.dataset.view); });
window.addEventListener("beforeunload", (e) => { if (hasUnsavedEdits()) e.preventDefault(); });
window.addEventListener("pagehide", stopAudio);

try {
  await loadDb();
  showView("flash");
} catch (err) {
  $("load-status").textContent = err instanceof TypeError ? "無法連線到伺服器，請用 start.cmd 啟動。" : err.message;
}
