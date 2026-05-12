// server/builtins/desktop-showcase.js
// Showcase desktop test: opens Notepad, types a long passage of text, maximises
// the window, runs OCR on screen, locates a target phrase by word-sequence
// match, then clicks + shift-clicks to highlight that phrase as a text range.

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function normalizeWord(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Find a run of consecutive OCR words matching the target phrase. Tolerates
// punctuation and case differences via normalizeWord.
function findWordRunInOcr(ocrWords, target) {
  const targetWords = target.trim().split(/\s+/).map(normalizeWord).filter(Boolean);
  if (targetWords.length === 0) return null;
  for (let i = 0; i <= ocrWords.length - targetWords.length; i++) {
    let matched = true;
    for (let j = 0; j < targetWords.length; j++) {
      if (normalizeWord(ocrWords[i + j].text) !== targetWords[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return {
        firstWord: ocrWords[i],
        lastWord: ocrWords[i + targetWords.length - 1],
      };
    }
  }
  return null;
}

module.exports = async function (driver, parameters = {}, zephyrLog) {
  if (typeof zephyrLog !== "function") zephyrLog = function () {};

  const fullText = parameters.fullText || "";
  const targetText = parameters.textToHighlight || "";

  if (!fullText.trim()) throw new Error("Parameter 'fullText' is empty.");
  if (!targetText.trim()) throw new Error("Parameter 'textToHighlight' is empty.");

  try {
    log("Launching Notepad...");
    await driver.launch("notepad.exe");
    await driver.pause(2500);
    zephyrLog("Launched Notepad.", "Pass");

    log("Maximising Notepad window...");
    await driver.focusWindow("Notepad");
    await driver.pause(300);
    await driver.maximizeWindow("Notepad");
    await driver.pause(800);
    zephyrLog("Maximised Notepad.", "Pass");

    log("Typing passage into Notepad (this may take a minute)...");
    // SendKeys interprets {ENTER} as Enter — convert newlines so paragraphs land cleanly.
    const sendable = fullText.replace(/\r\n/g, "\n").replace(/\n/g, "{ENTER}");
    const CHUNK = 400;
    for (let i = 0; i < sendable.length; i += CHUNK) {
      await driver.type(sendable.slice(i, i + CHUNK));
      await driver.pause(80);
    }
    zephyrLog("Typed passage into Notepad.", "Pass");

    log("Scrolling to top of document (Ctrl+Home)...");
    await driver.keyPress("Ctrl", "Home");
    await driver.pause(700);

    log(`OCR: searching screen for "${targetText}"...`);
    const ocr = await driver.readText();
    if (!ocr || !Array.isArray(ocr.words) || ocr.words.length === 0) {
      throw new Error("OCR returned no words — is Notepad visible and in focus?");
    }
    const match = findWordRunInOcr(ocr.words, targetText);
    if (!match) {
      throw new Error(`OCR did not find target phrase "${targetText}" on screen.`);
    }
    zephyrLog(`OCR located target phrase "${targetText}".`, "Pass");

    const first = match.firstWord.bbox;
    const last = match.lastWord.bbox;
    const startX = first.x0 + 1;
    const startY = Math.round((first.y0 + first.y1) / 2);
    const endX = last.x1 - 1;
    const endY = Math.round((last.y0 + last.y1) / 2);

    log(`Click range start (${startX}, ${startY}) -> shift-click end (${endX}, ${endY})...`);
    await driver.selectRange(startX, startY, endX, endY);
    zephyrLog("Highlighted target phrase via click + shift-click range.", "Pass");

    log("PASS: Showcase test completed successfully.");
  } catch (err) {
    zephyrLog("FAIL: " + (err && err.message), "Fail");
    process.stderr.write(`FAIL: ${err && err.message}\n`);
    throw err;
  }
};
