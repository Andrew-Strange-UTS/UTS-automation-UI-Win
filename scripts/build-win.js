#!/usr/bin/env node
// scripts/build-win.js
// Runs electron-builder for Windows with visible progress.
//
// electron-builder goes quiet for long stretches (downloading its toolchain,
// packaging, signing, NSIS), which looks like a hang. This streams its output
// and prints an elapsed-time heartbeat whenever it has been silent for a while,
// plus clearer stage banners and a final summary, so you can see it is working.

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const start = Date.now();
const secs = () => Math.round((Date.now() - start) / 1000);
const HEARTBEAT_IDLE_MS = 10000; // announce if this long with no output
const HEARTBEAT_TICK_MS = 2000;

// Friendlier labels for electron-builder's own stage lines.
const STAGE_HINTS = [
  [/packaging/i, "Packaging the app (copying Electron + your files)"],
  [/building.*target=nsis|makensis/i, "Building the NSIS installer"],
  [/signing/i, "Signing"],
  [/downloading/i, "Downloading build toolchain"],
  [/rebuild|native dependencies/i, "Rebuilding native dependencies"],
];

function announceStage(line) {
  for (const [re, label] of STAGE_HINTS) {
    if (re.test(line)) {
      process.stdout.write(`\n▶ ${label}  (${secs()}s)\n`);
      return;
    }
  }
}

const binName = process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";
const bin = path.join(__dirname, "..", "node_modules", ".bin", binName);

if (!fs.existsSync(bin)) {
  console.error(`electron-builder not found at ${bin}. Run 'npm install' first.`);
  process.exit(1);
}

console.log("Building the Marvin Windows installer...");
console.log("(this can take a few minutes; progress is shown below)\n");

const child = spawn(bin, ["--win"], { stdio: ["inherit", "pipe", "pipe"] });

let lastOutput = Date.now();

function wire(stream, dest) {
  let buffer = "";
  stream.on("data", (chunk) => {
    lastOutput = Date.now();
    dest.write(chunk);
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      announceStage(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  });
}
wire(child.stdout, process.stdout);
wire(child.stderr, process.stderr);

const heartbeat = setInterval(() => {
  if (Date.now() - lastOutput >= HEARTBEAT_IDLE_MS) {
    process.stdout.write(`   ...still working (${secs()}s elapsed)\n`);
    lastOutput = Date.now();
  }
}, HEARTBEAT_TICK_MS);

child.on("exit", (code) => {
  clearInterval(heartbeat);
  if (code === 0) {
    console.log(`\n✔ Build finished in ${secs()}s.`);
    const outDir = path.join(__dirname, "..", "dist");
    try {
      const setup = fs.readdirSync(outDir).find((f) => /Setup .*\.exe$/i.test(f));
      if (setup) console.log(`  Installer: dist/${setup}`);
      console.log(`  Unpacked app (for deploy-win.ps1): dist/win-unpacked`);
    } catch {
      // dist listing is best-effort.
    }
  } else {
    console.error(`\n✖ Build failed after ${secs()}s (exit code ${code}).`);
    console.error(`  If the NSIS step failed on a locked-down machine, deploy`);
    console.error(`  dist/win-unpacked with scripts/deploy-win.ps1 instead.`);
  }
  process.exit(code);
});

child.on("error", (err) => {
  clearInterval(heartbeat);
  console.error(`Could not start electron-builder: ${err.message}`);
  process.exit(1);
});
