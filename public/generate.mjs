// Writes replies + chunks for a situation with Claude.
// The caller passes in the Anthropic client (see ai.mjs), so tests can use a fake one.

export const MODEL = "claude-opus-5-5";
const MAX_REPLIES = 40;

const SCHEMA = {
  type: "object",
  properties: {
    replies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          intention: { type: "string" },
          channel: { type: "string" },
          reply: { type: "string" },
          chunks: { type: "array", items: { type: "string" } },
        },
        required: ["intention", "channel", "reply", "chunks"],
        additionalProperties: false,
      },
    },
  },
  required: ["replies"],
  additionalProperties: false,
};

const SYSTEM = `You write natural English replies for a Taiwanese teacher who is training to respond spontaneously in English.

You get a situation (often in Chinese), a list of intentions (the purpose of the reply) and a list of channels (the form of communication). For every intention × channel combination, write the requested number of replies.

Intentions are labels chosen by the user, usually Chinese followed by an English gloss (e.g. "讚許 Praise"). 追問 Follow-up means a question that keeps the conversation going. Interpret any other label by its meaning.
Channels:
- 群組訊息 Group chat: short, casual written message in a LINE/WhatsApp group. Contractions, light tone, may address the group.
- 口頭對話 Spoken: what a native-speaking teacher would actually say out loud, face to face.
- 正式書信 Formal writing: letter or email register. Complete sentences, polite, no slang.
Other channel names: infer the register from the name.

Rules:
- Replies are English only, sound like a real person, and fit the situation and the teacher's role.
- Different replies in the same combination must use different wording and different chunks.
- chunks: 2–4 per reply. A chunk is a phrase or sentence frame the teacher can reuse in other situations: collocations, fixed expressions, sentence starters (e.g. "that's a great choice", "what made you ...", "I'd like to point out that ..."). Prefer chunks that do not depend on this situation's specific names or topics. Each chunk must appear in the reply word for word; use "..." for a part that can be replaced, e.g. "not only ... but also". Never a single common word.
- Use the intention and channel strings exactly as given.
- Do not repeat any of the existing replies listed.`;

function str(value) {
  return typeof value === "string" ? value.trim() : "";
}
function list(value) {
  return Array.isArray(value) ? [...new Set(value.map(str).filter(Boolean))] : [];
}

/** Returns { input } or { error } (error text is shown to the user). */
export function parseInput(body) {
  const title = str(body?.title).slice(0, 80);
  const situation = str(body?.situation).slice(0, 2000);
  const intentions = list(body?.intentions).slice(0, 12);
  const channels = list(body?.channels).slice(0, 8);
  const perCombo = Math.min(3, Math.max(1, Math.floor(Number(body?.perCombo)) || 1));
  const existing = list(body?.existing).slice(0, 60).map((x) => x.slice(0, 500));
  if (!situation) return { error: "請填寫情境說明。" };
  if (!intentions.length) return { error: "請至少選一個回應目的。" };
  if (!channels.length) return { error: "設定中沒有任何溝通形式。" };
  if (intentions.length * channels.length * perCombo > MAX_REPLIES)
    return { error: `一次最多產生 ${MAX_REPLIES} 句，請減少回應目的或每組句數。` };
  return { input: { title, situation, intentions, channels, perCombo, existing } };
}

function userPrompt({ title, situation, intentions, channels, perCombo, existing }) {
  return [
    title && `Situation title: ${title}`,
    `Situation:\n${situation}`,
    `Intentions: ${JSON.stringify(intentions)}`,
    `Channels: ${JSON.stringify(channels)}`,
    `Replies per combination: ${perCombo}`,
    existing.length ? `Existing replies (do not repeat):\n${existing.map((x) => "- " + x).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Keeps only well-formed replies for the requested combinations; chunks must occur in the reply. */
export function cleanReplies(raw, { intentions, channels }) {
  const replies = Array.isArray(raw?.replies) ? raw.replies : [];
  return replies
    .map((r) => ({ intention: str(r?.intention), channel: str(r?.channel), reply: str(r?.reply), chunks: list(r?.chunks) }))
    .filter((r) => r.reply && intentions.includes(r.intention) && channels.includes(r.channel))
    .map((r) => {
      const lower = r.reply.toLowerCase().replace(/[’]/g, "'");
      const inReply = (chunk) =>
        chunk
          .split(/\.{2,}|…/)
          .map((part) => part.trim().toLowerCase().replace(/[’]/g, "'"))
          .filter(Boolean)
          .every((part) => lower.includes(part));
      return { ...r, chunks: r.chunks.filter(inReply) };
    });
}

export async function generateReplies(client, input) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt(input) }],
  });
  if (response.stop_reason === "refusal") throw new Error("AI 拒絕了這個請求，請修改情境描述後再試。");
  if (response.stop_reason === "max_tokens") throw new Error("輸出太長被截斷，請減少選項或每組句數。");
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI 回傳格式錯誤，請再試一次。");
  }
  return cleanReplies(parsed, input);
}
