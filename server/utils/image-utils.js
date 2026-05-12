// server/utils/image-utils.js
// Image processing utilities for OCR and template matching.
// Uses tesseract.js (pure JS OCR) and jimp (pure JS image manipulation).

const Jimp = require("jimp");
const { createWorker } = require("tesseract.js");
const fs = require("fs");
const path = require("path");

// ─── Tesseract worker (lazy init, reused across calls) ───

let tesseractWorker = null;

async function getWorker(lang = "eng") {
  if (!tesseractWorker) {
    tesseractWorker = await createWorker(lang);
  }
  return tesseractWorker;
}

async function terminateWorker() {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
  }
}

// ─── Screenshot region crop ───

async function cropScreenshot(screenshotPath, region) {
  const image = await Jimp.read(screenshotPath);
  if (region) {
    image.crop({ x: region.x, y: region.y, w: region.width, h: region.height });
  }
  const buffer = await image.getBuffer("image/png");
  return buffer;
}

async function cropAndSave(screenshotPath, region, outputPath) {
  const buffer = await cropScreenshot(screenshotPath, region);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// ─── OCR ───

async function ocrFromImage(imagePathOrBuffer, options = {}) {
  const lang = options.lang || "eng";
  const worker = await getWorker(lang);
  // Pass `blocks: true` so word-level data is included in the result.
  const result = await worker.recognize(imagePathOrBuffer, {}, { blocks: true });

  // Find words at the top level (old API) or flatten from blocks (new API).
  let words = result.data.words;
  if (!words || words.length === 0) {
    words = [];
    for (const block of result.data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          for (const word of line.words || []) {
            words.push(word);
          }
        }
      }
    }
  }

  return {
    text: (result.data.text || "").trim(),
    confidence: result.data.confidence,
    words: words.map((w) => ({
      text: w.text,
      confidence: w.confidence,
      bbox: w.bbox,
    })),
  };
}

// ─── Template matching (find needle image in haystack image) ───

function toGrayscale(image) {
  const w = image.width;
  const h = image.height;
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = image.getPixelColor(x, y);
      const r = (color >> 24) & 0xff;
      const g = (color >> 16) & 0xff;
      const b = (color >> 8) & 0xff;
      gray[y * w + x] = r * 0.299 + g * 0.587 + b * 0.114;
    }
  }
  return { data: gray, width: w, height: h };
}

function computeMeanAndStd(gray, startX, startY, w, h, strideW) {
  let sum = 0;
  let sumSq = 0;
  const count = w * h;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const val = gray[(startY + dy) * strideW + (startX + dx)];
      sum += val;
      sumSq += val * val;
    }
  }
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return { mean, std: Math.sqrt(Math.max(0, variance)) };
}

async function findImageOnScreen(haystackPath, needlePath, options = {}) {
  const threshold = options.threshold || 0.85;

  let haystack = await Jimp.read(haystackPath);
  const needle = await Jimp.read(needlePath);

  // Optionally crop haystack to a region for faster search
  if (options.region) {
    const r = options.region;
    haystack = haystack.crop({ x: r.x, y: r.y, w: r.width, h: r.height });
  }

  const hGray = toGrayscale(haystack);
  const nGray = toGrayscale(needle);

  const hW = hGray.width;
  const nW = nGray.width;
  const nH = nGray.height;

  // Precompute needle stats
  const needleStats = computeMeanAndStd(nGray.data, 0, 0, nW, nH, nW);
  if (needleStats.std < 1) {
    // Needle is a solid colour — can't do NCC meaningfully
    return { found: false, reason: "Needle image is a solid colour" };
  }

  let bestScore = -1;
  let bestX = 0;
  let bestY = 0;

  const maxX = hW - nW;
  const maxY = hGray.height - nH;

  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      // Fast reject: compare first row mean
      let firstRowSum = 0;
      for (let dx = 0; dx < nW; dx++) {
        firstRowSum += hGray.data[y * hW + x + dx];
      }
      const firstRowMean = firstRowSum / nW;
      let needleFirstRowSum = 0;
      for (let dx = 0; dx < nW; dx++) {
        needleFirstRowSum += nGray.data[dx];
      }
      const needleFirstRowMean = needleFirstRowSum / nW;
      if (Math.abs(firstRowMean - needleFirstRowMean) > 40) continue;

      // NCC computation
      const patchStats = computeMeanAndStd(hGray.data, x, y, nW, nH, hW);
      if (patchStats.std < 1) continue;

      let crossCorr = 0;
      for (let dy = 0; dy < nH; dy++) {
        for (let dx = 0; dx < nW; dx++) {
          const hVal = hGray.data[(y + dy) * hW + (x + dx)] - patchStats.mean;
          const nVal = nGray.data[dy * nW + dx] - needleStats.mean;
          crossCorr += hVal * nVal;
        }
      }

      const ncc = crossCorr / (patchStats.std * needleStats.std * nW * nH);

      if (ncc > bestScore) {
        bestScore = ncc;
        bestX = x;
        bestY = y;
      }
    }
  }

  // Adjust coordinates back if region was specified
  const offsetX = options.region ? options.region.x : 0;
  const offsetY = options.region ? options.region.y : 0;

  if (bestScore >= threshold) {
    return {
      found: true,
      x: bestX + offsetX,
      y: bestY + offsetY,
      centerX: bestX + offsetX + Math.floor(nW / 2),
      centerY: bestY + offsetY + Math.floor(nH / 2),
      confidence: bestScore,
    };
  }

  return { found: false, confidence: bestScore };
}

module.exports = {
  cropScreenshot,
  cropAndSave,
  ocrFromImage,
  findImageOnScreen,
  terminateWorker,
};
