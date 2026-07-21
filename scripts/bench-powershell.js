#!/usr/bin/env node
// scripts/bench-powershell.js
// Times PowerShell invocation exactly the way the desktop driver does it.
//
// Measure-Command run from an interactive console measures PowerShell spawning
// PowerShell. Marvin's chain is Marvin.exe -> node.exe -> cmd.exe ->
// powershell.exe, and security tooling weighs child processes by their
// ancestry, so the two can differ by an order of magnitude. This reproduces
// the driver's exact call so the numbers are comparable to a real test run.
//
// Run:
//   node scripts\bench-powershell.js
//   node scripts\bench-powershell.js 20        (20 iterations)

const { exec } = require("child_process");

const ITERATIONS = parseInt(process.argv[2], 10) || 10;

// Same wrapper the driver builds in runPowerShell().
function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const wrapped = `$ErrorActionPreference = 'Stop'; try { ${script} } catch { Write-Error $_; exit 1 }`;
    const encoded = Buffer.from(wrapped, "utf16le").toString("base64");
    const started = Date.now();
    exec(
      `powershell -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encoded}`,
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
      (err) => (err ? reject(err) : resolve(Date.now() - started))
    );
  });
}

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
    mean: Math.round(sum / sorted.length),
  };
}

async function bench(label, script) {
  const times = [];
  for (let i = 0; i < ITERATIONS; i++) {
    times.push(await runPowerShell(script));
  }
  const s = stats(times);
  console.log(
    `${label.padEnd(28)} mean ${String(s.mean).padStart(6)}ms   ` +
      `median ${String(s.median).padStart(6)}ms   min ${s.min}ms   max ${s.max}ms`
  );
  return s;
}

(async () => {
  console.log(`PowerShell invocation benchmark, ${ITERATIONS} iterations each`);
  console.log(`parent chain: node -> cmd -> powershell (the driver's path)\n`);

  const bare = await bench("bare command", "1 | Out-Null");

  const addType = await bench(
    "with inline Add-Type",
    `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BenchOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
}
"@; 1 | Out-Null`
  );

  // A real drag's shape: the sleeps and the step loop, without moving the mouse.
  const dragShape = await bench(
    "drag-shaped workload",
    `Start-Sleep -Milliseconds 150; Start-Sleep -Milliseconds 150; ` +
      `for ($i=0; $i -lt 15; $i++) { Start-Sleep -Milliseconds 12 }; ` +
      `Start-Sleep -Milliseconds 150`
  );

  console.log("\nInterpretation:");
  console.log(`  Process creation overhead:  ~${bare.mean}ms per action`);
  console.log(`  Add-Type compile adds:      ~${Math.max(0, addType.mean - bare.mean)}ms`);
  console.log(`  A drag should cost about:   ~${dragShape.mean}ms`);
  console.log("");
  if (bare.mean > 1000) {
    console.log("  Process creation is the bottleneck. Each action pays it, and no");
    console.log("  amount of PowerShell-side optimisation will help. Either the");
    console.log("  install directory needs a security-tool exclusion, or the driver");
    console.log("  needs to stop spawning a process per action.");
  } else {
    console.log("  Process creation looks healthy here. If real test actions are far");
    console.log("  slower than the drag-shaped figure above, the cost is not in");
    console.log("  PowerShell and the difference is the parent process Marvin uses.");
  }
})().catch((err) => {
  console.error("Benchmark failed:", err.message);
  process.exit(1);
});
