// Calls Claude directly from the browser with the API key saved on this device.
// The SDK is loaded on first use, so the rest of the app works offline and without a key.
import { generateReplies, parseInput } from "./generate.mjs";
import { getSettings } from "./storage.mjs";

const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm";

export async function generate(body) {
  const { anthropicKey } = getSettings();
  if (!anthropicKey) throw new Error("尚未設定 Claude API key：請到「設定」填入。");
  const { input, error } = parseInput(body);
  if (!input) throw new Error(error);
  let Anthropic;
  try {
    ({ default: Anthropic } = await import(SDK_URL));
  } catch {
    throw new Error("無法載入 Claude 元件，請確認網路連線。");
  }
  const client = new Anthropic({ apiKey: anthropicKey, dangerouslyAllowBrowser: true });
  try {
    return await generateReplies(client, input);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("Claude API key 無效。");
    if (err instanceof Anthropic.RateLimitError) throw new Error("請求太頻繁，請稍後再試。");
    if (err instanceof Anthropic.APIConnectionError) throw new Error("無法連線到 Claude，請確認網路。");
    if (err instanceof Anthropic.APIError) throw new Error("Claude 服務錯誤（" + err.status + "）。");
    throw err;
  }
}
