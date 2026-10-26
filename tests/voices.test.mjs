import assert from "node:assert/strict";
import test from "node:test";
import { availableProfiles } from "../public/voices.mjs";

const v = (name, lang) => ({ name, lang, voiceURI: name });
const chosen = (voices) => Object.fromEntries(availableProfiles(voices).map((p) => [p.id, p.voice?.name ?? null]));

test("iPhone: natural voices chosen, novelty voices never", () => {
  const iphone = [
    v("Bad News", "en-US"), v("Zarvox", "en-US"), v("Trinoids", "en-US"), v("Albert", "en-US"), v("Fred", "en-US"),
    v("Whisper", "en-US"), v("Superstar", "en-US"), v("Grandma (English (US))", "en-US"), v("Rocko (English (UK))", "en-GB"),
    v("Samantha", "en-US"), v("Ava (Enhanced)", "en-US"), v("Aaron", "en-US"), v("Evan (Enhanced)", "en-US"),
    v("Daniel", "en-GB"), v("Kate (Enhanced)", "en-GB"), v("Arthur", "en-GB"), v("Martha", "en-GB"),
    v("Karen", "en-AU"), v("Rishi", "en-IN"),
  ];
  assert.deepEqual(chosen(iphone), {
    "us-female": "Ava (Enhanced)",
    "us-male": "Evan (Enhanced)",
    "gb-female": "Kate (Enhanced)",
    "gb-male": "Daniel",
  });
});

test("Android: Google voice codes map to the four profiles", () => {
  const android = [
    v("en-us-x-sfg-local", "en-US"), v("en-us-x-iol-network", "en-US"), v("en-us-x-tpd-local", "en-US"),
    v("en-gb-x-gba-network", "en_GB"), v("en-gb-x-rjs-local", "en_GB"), v("en-au-x-aua-local", "en-AU"),
  ];
  const result = chosen(android);
  assert.equal(result["us-female"], "en-us-x-sfg-local");
  assert.equal(result["us-male"], "en-us-x-iol-network");
  assert.equal(result["gb-female"], "en-gb-x-gba-network");
  assert.equal(result["gb-male"], "en-gb-x-rjs-local");
});

test("Windows/Edge: neural voices preferred", () => {
  const windows = [
    v("Microsoft David - English (United States)", "en-US"), v("Microsoft Zira - English (United States)", "en-US"),
    v("Microsoft Aria Online (Natural) - English (United States)", "en-US"), v("Microsoft Guy Online (Natural) - English (United States)", "en-US"),
    v("Microsoft Hazel - English (United Kingdom)", "en-GB"), v("Microsoft George - English (United Kingdom)", "en-GB"),
  ];
  const result = chosen(windows);
  assert.match(result["us-female"], /Aria/);
  assert.match(result["us-male"], /Guy/);
  assert.match(result["gb-female"], /Hazel/);
  assert.match(result["gb-male"], /George/);
});

test("phones that only list unnamed voices fall back to the system US/UK voice", () => {
  const profiles = availableProfiles([v("English United States", "en-US"), v("English United Kingdom", "en-GB")]);
  assert.deepEqual(profiles.map((p) => [p.lang, p.voice]), [["en-US", null], ["en-GB", null]]);
});
