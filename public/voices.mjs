// Picks natural-sounding English voices: US female, US male, UK female, UK male.
// Browsers do not report a voice's gender, so voices are matched by their known names on
// iPhone/iPad/Mac, Android, Windows and Chrome. Novelty voices (robotic, singing, "Bad News"…)
// are never used.

export const PROFILES = [
  { id: "us-female", lang: "en-US", label: "US female",
    names: /\b(Ava|Samantha|Allison|Susan|Zoe|Nicky|Joelle|Noelle|Aria|Jenny|Michelle|Ana|Zira|Google US English)\b|en-us-x-(sfg|iob|iog|tpc|tpf)/i },
  { id: "us-male", lang: "en-US", label: "US male",
    names: /\b(Evan|Tom|Alex|Aaron|Nathan|Guy|Davis|Christopher|Eric|Andrew|Brian|Roger|Steffan|David|Mark)\b|en-us-x-(iol|iom|tpd)/i },
  { id: "gb-female", lang: "en-GB", label: "UK female",
    names: /\b(Kate|Serena|Stephanie|Martha|Sonia|Libby|Maisie|Hazel|Google UK English Female)\b|en-gb-x-(gba|gbc|gbg)/i },
  { id: "gb-male", lang: "en-GB", label: "UK male",
    names: /\b(Daniel|Arthur|Oliver|Jamie|Ryan|Thomas|George|Google UK English Male)\b|en-gb-x-(gbb|gbd|rjs)/i },
];

// Apple's novelty and old-style voices. These are the robotic or "emotional" ones.
const NOVELTY = /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Organ|Pipe Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph|Princess|Agnes|Bruce|Vicki|Victoria|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;

const langOf = (v) => (v.lang || "").replace("_", "-").toLowerCase();
// Higher is better: Apple premium/enhanced and Microsoft/Google neural voices sound most natural.
function quality(v) {
  const n = v.name || "";
  if (/premium/i.test(n)) return 4;
  if (/enhanced|natural|neural/i.test(n)) return 3;
  if (/online|google|network/i.test(n)) return 2;
  return 1;
}

export function voiceFor(voices, profile) {
  const candidates = voices.filter((v) => langOf(v) === profile.lang.toLowerCase() && !NOVELTY.test(v.name) && profile.names.test(v.name));
  return candidates.sort((a, b) => quality(b) - quality(a))[0] || null;
}

// Profiles this device can actually play, each with its chosen voice.
// When no named voice is found (some Android phones only list "English United States"),
// the two locales are used without a named voice, so the system's default voice speaks.
export function availableProfiles(voices) {
  const found = PROFILES.map((p) => ({ ...p, voice: voiceFor(voices, p) })).filter((p) => p.voice);
  if (found.length) return found;
  return [
    { id: "en-US", lang: "en-US", label: "US", voice: null },
    { id: "en-GB", lang: "en-GB", label: "UK", voice: null },
  ];
}
