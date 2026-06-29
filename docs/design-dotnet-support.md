# Design: C# / .NET test support (EPEA-1916)

Status: Draft for review
Date: 29 Jun 2026
Story: EPEA-1916 (20 pts) "Add new languages support C# .NET. Can different langs be run at the same time?"

## 1. Summary

Marvin currently runs tests written in JavaScript (`run.js`). This document proposes
adding C# / .NET as a second supported test language so more testers and developers
can author automation in a language they already use, and answers the explicit story
question: can different languages run in the same sequence?

The core constraint is that today a test is not just "a script we execute": it is a
JS module that receives a live `driver` object by reference. Adding .NET is therefore
mostly a question of how a C# test obtains an equivalent driver. The rest (discovery,
parameters, secrets, Zephyr reporting, failure screenshots) follows from that choice.

## 2. How tests run today (background)

Grounding the design in the current code:

- A test lives in `tests/<name>/` with `run.js` and an optional `metadata.json`
  (title + `needed-parameters`) and an optional `images/` folder. See
  `docs/creating-tests.md`.
- `run.js` exports `async function (driver, parameters, zephyrLog)`.
- The sequence runner (`server/routes/sequence.js`) does NOT spawn each test as a
  separate process. It generates a single `run.js` that `require()`s every step's
  module and calls them in one Node process, injecting a shared `driver`:
  - desktop driver: `server/runners/desktop-runner.js` (PowerShell + Win32 / UIAutomation)
  - web driver: Selenium WebDriver, built inline (see also `server/runners/web-runner.js`)
- `parameters` is built per step and merged with decrypted secrets
  (`server/secrets.js`), with `${{ secrets.NAME }}` references resolved.
- `zephyrLog(result, status)` accumulates per-step results; the runner posts them
  via `server/utils/zephyr.js`.
- The scheduler (`server/scheduler-service.js`) generates an equivalent `run.js`.
- There is a legacy precedent for multi-language in `server/routes/tests.js`: it will
  spawn `run.js` (node) or `run.py` (python3) as a child process. Crucially that path
  passes parameters via environment variables and captures stdout only. It does NOT
  inject a driver, so it cannot run a real desktop or web test. It is not a usable
  model for .NET, but it shows the project already anticipated more than one language.

Key takeaway: the JS model works because Node can `require()` the test and hand it an
in-process object. A C# test runs in the .NET runtime, a different process, so it
needs a cross-process way to drive the browser / desktop.

## 3. Proposed acceptance criteria (replacing "TBC")

- AC1: A test folder containing `run.cs` (instead of `run.js`) is detected and shown
  as a test card, with the same `metadata.json` contract (title, needed-parameters).
- AC2: A C# desktop test and a C# web test each run end to end against the same
  driver capabilities exposed to JS tests (window control, type/click, screenshot,
  OCR, image match for desktop; Selenium for web).
- AC3: `parameters` (including decrypted secrets) are available to the C# test.
- AC4: The C# test can report per-step Zephyr results equivalent to `zephyrLog`.
- AC5: Failure screenshots (EPEA-2514) work for C# tests too.
- AC6: The startup diagnostics screen (`server/routes/health.js`) reports whether the
  .NET SDK / runtime is available, with a remediation hint when it is not.
- AC7: A single run sequence may mix JS and C# steps and complete correctly
  (this is the "can different languages run at the same time" requirement).
- AC8: `docs/creating-tests.md` documents the C# test contract and includes a
  copy-pasteable AI prompt, mirroring the JS section.
- AC9 (translation): a documented, repeatable way to produce an equivalent test in the
  other language (see section 8). Scope to confirm with product.

## 4. Design options for the driver

### Option A: Native .NET driver (reimplement the driver in C#)

C# tests use Selenium .NET bindings directly for web, and a .NET desktop automation
library (FlaUI, which wraps UIAutomation) for desktop. Marvin compiles and runs the
test; the test talks to a small `Marvin.Testing` NuGet/local package that provides
`driver`, `parameters`, and `zephyrLog`.

- Pros: idiomatic C#; FlaUI is far nicer than shelling out to PowerShell; no IPC hop
  so it is fast and debuggable; Selenium .NET is first class.
- Cons: two driver implementations to keep in sync (JS desktop-runner.js and a C#
  one); desktop behaviour could subtly diverge; more code to own.

### Option B: Driver bridge over local IPC (single source of truth)

Keep the existing Node driver. Expose it as a local JSON-RPC endpoint for the lifetime
of a run. Ship a thin C# client (`Marvin.Driver`) whose methods serialise calls to the
Node driver and await results. The C# test "drives" the same `desktop-runner.js` /
Selenium session the JS tests use.

- Pros: one driver implementation; guaranteed parity; the C# surface is generated from
  the JS method list; desktop screenshot/OCR/image logic stays in one place.
- Cons: an RPC protocol to define and version; every call is an async round trip
  (latency, though local and small); handle/session lifetime must be coordinated;
  for web, proxying a Selenium WebDriver call-by-call through Node is awkward.

### Option C: Transpile C# to JS

Out of scope: brittle, and a non-goal. Rejected.

### Recommendation

Hybrid, split by mode:

- Web tests: Option A. Selenium has official, well supported C# bindings. A C# web
  test should just use `OpenQA.Selenium` directly with a `driver` we hand it. No bridge
  needed; the browser is the shared resource, not a JS object.
- Desktop tests: Option B-lite. Rather than a full RPC layer, expose the existing
  desktop driver behind a tiny local HTTP/stdio command server for the run, and ship a
  generated `Marvin.Driver` C# client. This keeps the PowerShell/UIAutomation and the
  image/OCR pipeline (`server/utils/image-utils.js`) as the single implementation,
  which matters because that is where most of the desktop complexity and the recently
  added methods (findControl, drag, scroll, screenshotWindow) live.

If maintaining a bridge proves heavier than expected, fall back to FlaUI for desktop
(full Option A). Decide after the spike in Phase 1.

## 5. Recommended architecture

### 5.1 Language detection and the runner abstraction

Introduce an explicit notion of a test's language, derived from its entry file:

- `run.js`  -> language `js`
- `run.cs`  -> language `cs`

Add a `detectLanguage(testDir)` helper (in a new `server/runners/languages.js`) used by
test discovery (`server/routes/tests.js` and the renderer test-card builder) and by the
sequence/scheduler compilers. `metadata.json` may also carry `"language": "cs"` to be
explicit; the file name is the default.

Refactor the per-step execution in `server/routes/sequence.js` and
`server/scheduler-service.js` so a "step" is dispatched to a language-specific executor
rather than always inlined as a JS `require`. Today both files build one big Node
`run.js`. The change: the generated orchestrator loops over steps and, per step,
either calls the in-process JS function (as now) or invokes the C# executor for that
step (see 5.4). The orchestrator stays in Node because it already owns Zephyr posting,
failure screenshots, OKTA wrapping, and the shared driver/session.

### 5.2 C# test contract

A C# test is a single file `run.cs` that the runtime executes via `dotnet script`
(the simplest model, no `.csproj` needed) or compiles into a tiny console app. Proposed
contract:

```csharp
// run.cs
using Marvin.Testing;        // provided by Marvin (driver, parameters, zephyrLog)

return await Test.Run(async (driver, parameters, zephyr) =>
{
    zephyr.Guard();                          // no-op safety like the JS guard
    await driver.Launch("notepad.exe");
    await driver.Type("Hello from C#");
    zephyr.Log("Typed into Notepad", "Pass");
});
```

`Marvin.Testing` provides:
- `driver`: web -> a thin wrapper over `OpenQA.Selenium.IWebDriver`; desktop -> the
  generated `Marvin.Driver` client (section 5.4) mirroring the JS method names.
- `parameters`: `IReadOnlyDictionary<string,string>` populated from a JSON file path in
  an env var (see 5.3).
- `zephyr.Log(actual, status)`: writes a structured marker line to stdout that the Node
  orchestrator parses, identical in spirit to how step pass/fail is parsed today in
  `App.jsx` `handleSequenceLog`.

### 5.3 Parameters and secrets

The Node orchestrator already computes `parametersWithSecrets` per step. For a C# step
it writes that step's params to a temp JSON file inside the per-run sequence folder and
passes the path via `MARVIN_PARAMS_FILE`. Secrets are never placed on the command line
or in logs (consistent with current behaviour). `Marvin.Testing` reads and exposes them.

### 5.4 Desktop driver bridge (the only new protocol)

For the duration of a run, the Node side starts a small command server bound to
loopback that wraps the existing `createDesktopDriver(...)` object. Protocol: newline
delimited JSON over stdio or a localhost port, request `{ id, method, args }`, response
`{ id, ok, result | error }`. The C# `Marvin.Driver` is generated from the JS method
list so the two never drift:

- one C# async method per JS driver method (type, keyPress, mouseClick, drag, scroll,
  findControl, screenshot, screenshotWindow, readText, findImage, waitForImage, etc.)
- errors thrown in PowerShell surface as C# exceptions with the same message.

This preserves a single desktop implementation (PowerShell + UIAutomation + the
image/OCR worker) and means new driver methods are available to C# automatically.

### 5.5 Web driver

No bridge. For a C# web step, the orchestrator does not build the Node Selenium driver;
instead it launches the C# executor with the detected Chrome binary path
(`server/utils/chromeFinder.js`) and OKTA/visual flags via env, and the C# test builds
its own `ChromeDriver` through `Marvin.Testing` (which centralises options: headless,
`--no-sandbox`, binary path, snap warning). OKTA wrapping for C# web steps reuses the
same bookend approach as JS by running the existing builtin login steps around the C#
step, or by exposing login helpers in `Marvin.Testing`. Confirm during Phase 2.

### 5.6 Zephyr, failure screenshots, diagnostics

- Zephyr: `zephyr.Log(...)` markers are collected by the Node orchestrator and posted
  through the existing `postTestExecution` (`server/utils/zephyr.js`), including the
  `executedBy` tester name (EPEA-2692). No second Zephyr client needed.
- Failure screenshots (EPEA-2514): when a C# step exits non-zero, the orchestrator
  takes the screenshot via the shared driver (desktop bridge or the C# web driver
  handing back a path), reusing `captureFailureScreenshot` so thumbnails and bundle
  inclusion keep working unchanged.
- Diagnostics: add a `dotnet` check to `server/routes/health.js` (`dotnet --version`),
  with a remediation hint + install link, mirroring the existing checks. Add a
  `csharpTests` feature flag to the features summary.

### 5.7 "Can different languages run at the same time?"

Yes, with the runner refactor in 5.1. A sequence is an ordered list of steps; each step
is dispatched to its language executor while the orchestrator, the browser/desktop
session, Zephyr posting, and failure capture stay shared. So a sequence can be
`[js, cs, js]` and run as one logical run. The clarification worth stating to product:
"at the same time" means within one sequence run, sequentially, sharing a session. It
does not mean a single test file written in two languages, and it does not mean two
language runtimes mutating the same desktop concurrently in parallel.

## 6. Packaging and distribution impact

- The app must be able to run `dotnet`. Two choices:
  1. Require the .NET runtime on the host (smallest installer; diagnostics guides the
     user to install it). Recommended for v1.
  2. Bundle a self-contained .NET runtime under `extraResources` (large installer,
     zero host dependency). Defer unless required.
- If `dotnet script` is used, document installing it (`dotnet tool install -g
  dotnet-script`) or vendor the compile step. Decide in Phase 1.
- No change to the Electron/NSIS build itself beyond possibly adding the runtime to
  `extraResources` in `package.json` if we choose to bundle.

## 7. Phased delivery

1. Spike (1 to 2 days): prove a `run.cs` desktop test driving Notepad via the bridge,
   and a `run.cs` Selenium test. Validate `dotnet script` vs `.csproj`. Lock the
   bridge protocol. Output: decision record + throwaway code.
2. Runner refactor: language detection + per-step dispatch in `sequence.js` and
   `scheduler-service.js`, keeping JS behaviour identical.
3. Marvin.Testing + Marvin.Driver: parameters/secrets, zephyr markers, the generated
   desktop client, web helper.
4. Diagnostics, failure screenshots, docs + AI prompt, a built-in C# sample test.
5. Translation deliverable (section 8) if in scope.

## 8. Translation ("Adding a way of translating languages")

This AC is ambiguous; proposed interpretation, to confirm with product. Most valuable
and lowest risk: keep the driver API surface and method names identical across JS and
C#, then provide a documented, copy-pasteable AI prompt in `docs/creating-tests.md`
that converts a test from one language to the other given that shared surface. A
deterministic source-to-source transpiler is explicitly out of scope (high cost, low
value). If product wants more, a small CLI that scaffolds the equivalent file with the
mapped driver calls is a reasonable middle ground.

## 9. Risks and open questions

- Bridge latency for chatty desktop tests; mitigate by batching where possible.
- `dotnet script` startup time per step; consider a persistent compile cache.
- OKTA wrapping semantics for C# web steps need confirmation (5.5).
- Host dependency on the .NET SDK/runtime vs bundling (section 6).
- Maintenance cost of the generated C# client; mitigated by generation, not hand code.
- Confirm the exact scope of the translation AC before building anything for it.
