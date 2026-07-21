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
// Every failure is reported in full: if PowerShell is being killed rather than
// running slowly, that is the finding, not a broken benchmark.
//
// Run:
//   node scripts\bench-powershell.js
//   node scripts\bench-powershell.js 20        (20 iterations)

const { exec } = require("child_process");

const ITERATIONS = parseInt(process.argv[2], 10) || 10;

// Same wrapper the driver builds in runPowerShell(), but resolving with the
// full outcome instead of throwing, so one bad run does not end the benchmark.
function runPowerShell(script) {
  return new Promise((resolve) => {
    const wrapped = `$ErrorActionPreference = 'Stop'; try { ${script} } catch { Write-Error $_; exit 1 }`;
    const encoded = Buffer.from(wrapped, "utf16le").toString("base64");
    const started = Date.now();
    exec(
      `powershell -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encoded}`,
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          ms: Date.now() - started,
          ok: !err,
          code: err ? err.code : 0,
          killed: Boolean(err && err.killed),
          signal: err ? err.signal : null,
          stderr: (stderr || "").trim(),
          stdout: (stdout || "").trim(),
          message: err ? err.message : "",
        });
      }
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
  const failures = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const r = await runPowerShell(script);
    times.push(r.ms);
    if (!r.ok) failures.push(r);
  }

  const s = stats(times);
  console.log(
    `${label.padEnd(24)} mean ${String(s.mean).padStart(6)}ms   ` +
      `median ${String(s.median).padStart(6)}ms   min ${s.min}ms   max ${s.max}ms` +
      (failures.length ? `   FAILED ${failures.length}/${ITERATIONS}` : "")
  );

  if (failures.length) {
    const f = failures[0];
    console.log(`    exit code : ${f.code}`);
    console.log(`    killed    : ${f.killed}${f.signal ? ` (signal ${f.signal})` : ""}`);
    if (f.stderr) console.log(`    stderr    : ${f.stderr.split("\n").slice(0, 6).join("\n                ")}`);
    if (f.message) console.log(`    message   : ${f.message.split("\n")[0]}`);
  }

  const notFound = failures.some(
    (f) => /not found|not recognized|ENOENT/i.test(`${f.stderr} ${f.message}`)
  );

  return { stats: s, failures: failures.length, notFound };
}

(async () => {
  console.log(`PowerShell invocation benchmark, ${ITERATIONS} iterations each`);
  console.log(`parent chain: node -> cmd -> powershell (the driver's path)`);
  console.log(`node ${process.version}, cwd ${process.cwd()}\n`);

  // Simplest possible command: pure process-creation cost.
  const bare = await bench("bare command", "1 | Out-Null");

  // A real drag's shape: the fixed sleeps plus the step loop, without moving
  // the mouse. Anything above this is overhead, not work.
  const dragShape = await bench(
    "drag-shaped workload",
    `Start-Sleep -Milliseconds 150; Start-Sleep -Milliseconds 150; ` +
      `for ($i=0; $i -lt 15; $i++) { Start-Sleep -Milliseconds 12 }; ` +
      `Start-Sleep -Milliseconds 150`
  );

  console.log("\nInterpretation:");

  if (bare.failures) {
    if (bare.notFound) {
      console.log("  PowerShell is not on this machine's PATH, so there is nothing to");
      console.log("  measure. Run this on the Windows machine under test.");
      return;
    }
    console.log("  PowerShell FAILED when spawned from node, though the same command");
    console.log("  works from a console. That is a security-policy block on the");
    console.log("  process chain, not a performance problem. Send the error above.");
    return;
  }

  console.log(`  Process creation overhead : ~${bare.stats.mean}ms per action`);
  console.log(`  A drag should cost about  : ~${dragShape.stats.mean}ms`);
  console.log("");

  if (bare.stats.mean > 1000) {
    console.log("  Process creation is the bottleneck. Every action pays it, and no");
    console.log("  PowerShell-side optimisation will help. Either the install");
    console.log("  directory needs a security-tool exclusion, or the driver must");
    console.log("  stop spawning a process per action.");
  } else {
    console.log("  Process creation looks healthy from this parent. If real test");
    console.log("  actions are far slower than the drag-shaped figure above, the");
    console.log("  cost depends on the parent process, and running the same test");
    console.log("  from the installed app rather than dev is what differs.");
  }
})().catch((err) => {
  console.error("Benchmark itself failed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
