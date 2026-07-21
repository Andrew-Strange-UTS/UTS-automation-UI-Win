// server/utils/image-utils.test.js
// Run: node --test server/utils/image-utils.test.js
//
// Covers the resolution-mismatch reporting on findImageOnScreen. Matching
// itself is fixed-scale NCC, so these tests focus on the diagnostics a test
// author sees when a reference image was captured at the wrong resolution.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { Jimp } = require("jimp");
const { findImageOnScreen } = require("./image-utils");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "marvin-img-"));

// A noisy image, so NCC has real variance to work with. A flat fill would trip
// the solid-colour guard instead of exercising the path under test.
async function writeNoise(name, width, height, seed = 1) {
  const image = new Jimp({ width, height });
  let s = seed;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      s = (s * 1103515245 + 12345) % 2147483648;
      const v = s % 256;
      image.setPixelColor(((v << 24) | (v << 16) | (v << 8) | 0xff) >>> 0, x, y);
    }
  }
  const file = path.join(tmpDir, name);
  await image.write(file);
  return file;
}

test("reports both dimensions when the reference is larger than the screen", async () => {
  const screen = await writeNoise("small-screen.png", 40, 30);
  const reference = await writeNoise("big-reference.png", 80, 60);

  const result = await findImageOnScreen(screen, reference);

  assert.strictEqual(result.found, false);
  assert.match(result.reason, /larger than the search area/);
  // Both sizes must appear, that is what makes the mismatch diagnosable.
  assert.match(result.reason, /80x60/);
  assert.match(result.reason, /40x30/);
  assert.deepStrictEqual(result.searchArea, { width: 40, height: 30 });
  assert.deepStrictEqual(result.reference, { width: 80, height: 60 });
});

test("a normal miss still reports dimensions and the threshold", async () => {
  const screen = await writeNoise("screen.png", 60, 60, 7);
  const reference = await writeNoise("absent.png", 10, 10, 99);

  const result = await findImageOnScreen(screen, reference, { threshold: 0.99 });

  assert.strictEqual(result.found, false);
  assert.strictEqual(result.threshold, 0.99);
  assert.deepStrictEqual(result.searchArea, { width: 60, height: 60 });
  assert.deepStrictEqual(result.reference, { width: 10, height: 10 });
});

test("a successful match also carries dimensions", async () => {
  const screen = await writeNoise("haystack.png", 60, 60, 3);

  // Crop a region out of the screen so it is guaranteed to be present.
  const source = await Jimp.read(screen);
  const needlePath = path.join(tmpDir, "present.png");
  await source.clone().crop({ x: 10, y: 10, w: 12, h: 12 }).write(needlePath);

  const result = await findImageOnScreen(screen, needlePath, { threshold: 0.9 });

  assert.strictEqual(result.found, true);
  assert.deepStrictEqual(result.searchArea, { width: 60, height: 60 });
  assert.deepStrictEqual(result.reference, { width: 12, height: 12 });
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
