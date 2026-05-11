// renderer/src/App.jsx
import { useState, useRef, useEffect } from "react";
import TestCard from "@/components/TestCard";
import RunSequence from "@/components/RunSequence";
import LogGroup from "@/components/LogGroup";
import SecretsPanel from "@/components/SecretsPanel";
import PrivateRepoCheckbox from "@/components/PrivateRepoCheckbox";
import PATPopup from "@/components/PATPopup";
import SchedulePanel from "@/components/SchedulePanel";
import StartupChecks from "@/components/StartupChecks";
import { BACKEND_URL, WS_URL } from "@/config";
import theme from "@/theme";
import marvinQuotes from "@/marvinQuotes";
export default function App() {
  const [showStartupChecks, setShowStartupChecks] = useState(true);
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * marvinQuotes.length));
  useEffect(() => {
    const interval = setInterval(() => {
      setQuoteIndex((prev) => {
        let next;
        do { next = Math.floor(Math.random() * marvinQuotes.length); } while (next === prev && marvinQuotes.length > 1);
        return next;
      });
    }, 20000);
    return () => clearInterval(interval);
  }, []);
  // Refs for log state
  const sequenceBufferRef = useRef("");
  const logsAccumulatorRef = useRef({});
  const currentStepRef = useRef(null);
  const [repoUrl, setRepoUrl] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("repoUrl") || "" : ""
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("repoUrl", repoUrl);
    }
  }, [repoUrl]);
  const [tests, setTests] = useState([]);
  const [files, setFiles] = useState({});
  const [loading, setLoading] = useState(false);
  const [runSequence, setRunSequence] = useState([]);
  const [testOptions, setTestOptions] = useState({});
  const [testResults, setTestResults] = useState({});
  const [serverSideLogs, setServerSideLogs] = useState({});
  const [isServerLogExpanded, setIsServerLogExpanded] = useState(false);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [patPopupOpen, setPatPopupOpen] = useState(false);
  const [testType, setTestType] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("testType") || "desktop" : "desktop"
  );
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("testType", testType);
    }
    // Clear sequence when switching test types
    setRunSequence([]);
    setTestOptions({});
  }, [testType]);

  const [privateRepo, setPrivateRepo] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("privateRepo") === "true" : false
  );
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("privateRepo", privateRepo ? "true" : "false");
    }
  }, [privateRepo]);
  // WebSocket single test runner
  const handleRunTestViaWebSocket = (testName, options = {}, onDone) => {
    const startTime = new Date().toLocaleString();
    setServerSideLogs((prev) => ({
      ...prev,
      [testName]: `[${startTime}] ─ started...\n`,
    }));
    const socket = new WebSocket(WS_URL);
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: "RUN",
          test: testName,
          ...options,
        })
      );
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "log") {
          setServerSideLogs((prev) => ({
            ...prev,
            [testName]: (prev[testName] || "") + message.message + "\n",
          }));
        }
        if (message.type === "done") {
          setServerSideLogs((prev) => ({
            ...prev,
            [testName]: (prev[testName] || "") + `\n🟢 Stream completed.\n`,
          }));
          setTestResults((prev) => ({
            ...prev,
            [testName]: {
              status: message.status,
              time: startTime,
            },
          }));
          if (typeof onDone === "function") {
            onDone({ status: message.status, log: message.log, time: startTime });
          }
          socket.close();
        }
      } catch (err) {}
    };
    socket.onerror = (err) => {
      setServerSideLogs((prev) => ({
        ...prev,
        [testName]: (prev[testName] || "") + `\n❌ WebSocket error\n`,
      }));
      if (typeof onDone === "function") {
        onDone({ status: "❌ Failed", log: "WebSocket error", time: startTime });
      }
      socket.close();
    };
  };
  const handleOptionsChange = (testName, options) => {
    setTestOptions((prev) => ({
      ...prev,
      [testName]: { ...(prev[testName] || {}), ...options },
    }));
  };
  const handleToggleSequence = (testName, shouldAdd, flags) => {
    setRunSequence((prev) => {
      if (shouldAdd) {
        if (!prev.find((t) => t.name === testName)) {
          return [...prev, { name: testName, ...flags }];
        }
        return prev;
      }
      return prev.filter((t) => t.name !== testName);
    });
  };
  // ---------------- ADDED: check for Personal_Access_Token secret
  async function hasGithubSecrets() {
    try {
      const res = await fetch(`${BACKEND_URL}/api/secrets`, { cache: "no-store" });
      if (!res.ok) return false;
      const data = await res.json();
      const names = data.secrets || [];
      return names.includes("GITHUB_PERSONAL_ACCESS_TOKEN") && names.includes("GITHUB_USERNAME");
    } catch {
      return false;
    }
  }
  // ------------------------------------------------------------

  const handleClone = async () => {
    setLoading(true);
    setRunSequence([]);
    setTestResults({});
    setTestOptions({});
    // Check for PAT secret if privateRepo is checked
    if (privateRepo) {
      const patExists = await hasGithubSecrets();
      if (!patExists) {
        setPatPopupOpen(true);
        setPrivateRepo(false)
        setLoading(false);
        return;
      }
    }

    console.log("CLONE SUBMIT: repoUrl:", repoUrl, "privateRepo:", privateRepo);

    try {
      const res = await fetch(`${BACKEND_URL}/api/git/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, privateRepo }),
      });
      if (!res.ok) throw new Error("Failed to clone repo");
      const listRes = await fetch(`${BACKEND_URL}/api/git/list`);
      const data = await listRes.json();
      setTests(data);
      const filesMap = {};
      for (const testName of data) {
        const possibleFiles = ["run.js", "run.py"];
        let runFile = null;
        let runContent = null;
        for (const file of possibleFiles) {
          const tryFile = await fetch(`${BACKEND_URL}/api/git/${testName}/${file}`);
          if (tryFile.ok) {
            const result = await tryFile.json();
            runFile = file;
            runContent = result.content;
            break;
          }
        }
        let metaContent = null;
        try {
          const metaRes = await fetch(`${BACKEND_URL}/api/git/${testName}/metadata.json`);
          if (metaRes.ok) {
            const meta = await metaRes.json();
            metaContent = meta.content;
          }
        } catch (err) {}
        filesMap[testName] = {
          run: runContent,
          runFile,
          metadata: metaContent,
        };
      }
      setFiles(filesMap);
    } catch (err) {
      setTests([]);
    } finally {
      setLoading(false);
    }
  };
  function timestamp(line) {
    return `[${new Date().toLocaleTimeString()}] ${line}`;
  }
  // --- Streaming sequence log handler with status parsing ---
  const handleSequenceLog = (fullLog) => {
    const prev = sequenceBufferRef.current;
    const newRaw = fullLog.slice(prev.length);
    if (!newRaw) return;
    sequenceBufferRef.current = fullLog;
    const lines = newRaw.split(/\r?\n/).filter(Boolean);
    const logsAccumulator = logsAccumulatorRef.current;
    let currentTest = currentStepRef.current;
    for (const rawLine of lines) {
      const line = timestamp(rawLine);
      // Step running?
      const stepStart = line.match(/▶ Running step #\d+\s?\[(.*?)\]/);
      if (stepStart) {
        currentTest = stepStart[1];
        currentStepRef.current = currentTest;
        logsAccumulator["[SEQUENCE]"] = (logsAccumulator["[SEQUENCE]"] || "") + line + "\n";
        continue;
      }
      // Step pass:
      const stepDone = line.match(/✅ Finished step #\d+\s?\[(.*?)\]/);
      if (stepDone) {
        const testName = stepDone[1];
        logsAccumulator["[SEQUENCE]"] = (logsAccumulator["[SEQUENCE]"] || "") + line + "\n";
        currentTest = null;
        currentStepRef.current = null;
        setTestResults((prev) => ({
          ...prev,
          [testName]: {
            status: "✅ Passed",
            time: new Date().toLocaleString(),
          },
        }));
        continue;
      }
      // Step fail:
      const stepFail = line.match(/❌ Step #\d+\s?\[(.*?)\] failed:/);
      if (stepFail) {
        const testName = stepFail[1];
        setTestResults((prev) => ({
          ...prev,
          [testName]: {
            status: "❌ Failed",
            time: new Date().toLocaleString(),
          },
        }));
        continue;
      }
      // Accumulate logs per test or to [SEQUENCE]
      if (currentTest) {
        if (
          !line.includes("▶ Running step") &&
          !line.includes("✅ Finished step") &&
          !line.includes("❌ Step")
        ) {
          logsAccumulator[currentTest] = (logsAccumulator[currentTest] || "") + line + "\n";
        }
      } else {
        logsAccumulator["[SEQUENCE]"] = (logsAccumulator["[SEQUENCE]"] || "") + line + "\n";
      }
    }
    setServerSideLogs({
      ...logsAccumulator,
    });
  };
  const handleClearAllLogs = () => {
    logsAccumulatorRef.current = {};
    sequenceBufferRef.current = "";
    currentStepRef.current = null;
    setServerSideLogs({});
    setTestResults({});
  };
  const hiddenTests = [
    "OKTA-Prod-Login",
    "OKTA-Prod-Login-Finish",
    "OKTA-Test-Login",
    "OKTA-Test-Login-Finish",
    "OKTA-Preprod-Login",
    "OKTA-Preprod-Login-Finish",
  ];
  const visibleTests = tests.filter((testName) => !hiddenTests.includes(testName));

  const defaultTestRunContent = [
    'const { By } = require("selenium-webdriver");',
    '',
    'function log(msg) {',
    '  process.stdout.write(`${msg}\\n`);',
    '}',
    '',
    'module.exports = async function (driver, parameters = {}, zephyrLog) {',
    '  if (typeof zephyrLog !== "function") zephyrLog = function () {};',
    '',
    '  try {',
    '    log("Navigating to https://coursehandbook.uts.edu.au/");',
    '    await driver.get("https://coursehandbook.uts.edu.au/");',
    '    await driver.sleep(2000);',
    '',
    '    log("Looking for UTS logo image...");',
    '    const found = await driver.wait(async () => {',
    '      const logos = await driver.findElements(',
    '        By.css(\'img[alt="University of Technology Sydney"]\')',
    '      );',
    '      return logos.length > 0;',
    '    }, 10000);',
    '',
    '    if (!found) {',
    '      throw new Error("UTS logo image not found on page.");',
    '    }',
    '',
    '    log("PASS: UTS logo is present and visible.");',
    '    zephyrLog("Navigated to coursehandbook.uts.edu.au — UTS logo is present and visible.", "Pass");',
    '  } catch (err) {',
    '    zephyrLog("FAIL: " + (err && err.message), "Fail");',
    '    throw err;',
    '  }',
    '};',
  ].join('\n');

  const defaultDesktopTestRunContent = [
    'function log(msg) {',
    '  process.stdout.write(`${msg}\\n`);',
    '}',
    '',
    'module.exports = async function (driver, parameters = {}, zephyrLog) {',
    '  if (typeof zephyrLog !== "function") zephyrLog = function () {};',
    '',
    '  try {',
    '    log("Launching Notepad...");',
    '    await driver.launch("notepad.exe");',
    '    await driver.pause(2000);',
    '    zephyrLog("Launched Notepad successfully.", "Pass");',
    '',
    '    log("Typing test text...");',
    '    await driver.type("Hello from Marvin!");',
    '    await driver.pause(1000);',
    '    zephyrLog("Typed test text into Notepad.", "Pass");',
    '',
    '    log("Closing Notepad without saving...");',
    '    await driver.closeWindow();',
    '    await driver.pause(1000);',
    '    await driver.keyPress("Alt", "n");',
    '    await driver.pause(500);',
    '    zephyrLog("Closed Notepad without saving.", "Pass");',
    '  } catch (err) {',
    '    zephyrLog("FAIL: " + (err && err.message), "Fail");',
    '    throw err;',
    '  }',
    '};',
  ].join('\n');

  // Default text for the Notepad showcase test — Pride and Prejudice, chapter 1
  // (public domain). Contains the embedded target phrase used by the highlight step.
  const defaultDesktopShowcaseText = [
    'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.',
    '',
    'However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.',
    '',
    '"My dear Mr. Bennet," said his lady to him one day, "have you heard that Netherfield Park is let at last?"',
    '',
    'Mr. Bennet replied that he had not.',
    '',
    '"But it is," returned she; "for Mrs. Long has just been here, and she told me all about it."',
    '',
    'Mr. Bennet made no answer.',
    '',
    '"Do not you want to know who has taken it?" cried his wife impatiently.',
    '',
    '"You want to tell me, and I have no objection to hearing it."',
    '',
    'This was invitation enough.',
    '',
    '"Why, my dear, you must know, Mrs. Long says that Netherfield is taken by a young man of large fortune from the north of England; that he came down on Monday in a chaise and four to see the place, and was so much delighted with it that he agreed with Mr. Morris immediately; that he is to take possession before Michaelmas, and some of his servants are to be in the house by the end of next week."',
    '',
    '"What is his name?"',
    '',
    '"Bingley."',
    '',
    '"Is he married or single?"',
    '',
    '"Oh! single, my dear, to be sure! A single man of large fortune; four or five thousand a year. What a fine thing for our girls!"',
    '',
    '"How so? how can it affect them?"',
    '',
    '"My dear Mr. Bennet," replied his wife, "how can you be so tiresome! You must know that I am thinking of his marrying one of them."',
    '',
    '"Is that his design in settling here?"',
    '',
    '"Design! nonsense, how can you talk so! But it is very likely that he may fall in love with one of them, and therefore you must visit him as soon as he comes."',
    '',
    '"I see no occasion for that. You and the girls may go, or you may send them by themselves, which perhaps will be still better; for as you are as handsome as any of them, Mr. Bingley might like you the best of the party."',
    '',
    '"My dear, you flatter me. I certainly have had my share of beauty, but I do not pretend to be any thing extraordinary now. When a woman has five grown up daughters, she ought to give over thinking of her own beauty."',
    '',
    '"In such cases, a woman has not often much beauty to think of."',
    '',
    '"But, my dear, you must indeed go and see Mr. Bingley when he comes into the neighbourhood."',
    '',
    '"It is more than I engage for, I assure you."',
    '',
    '"But consider your daughters. Only think what an establishment it would be for one of them. Sir William and Lady Lucas are determined to go, merely on that account, for in general you know they visit no new comers. Indeed you must go, for it will be impossible for us to visit him, if you do not."',
    '',
    '"You are over scrupulous surely. I dare say Mr. Bingley will be very glad to see you; and I will send a few lines by you to assure him of my hearty consent to his marrying which ever he chuses of the girls; though I must throw in a good word for my little Lizzy."',
    '',
    '"I desire you will do no such thing. Lizzy is not a bit better than the others; and I am sure she is not half so handsome as Jane, nor half so good humoured as Lydia. But you are always giving her the preference."',
    '',
    'Mr. Bennet was so odd a mixture of quick parts, sarcastic humour, reserve, and caprice, that the experience of three and twenty years had been insufficient to make his wife understand his character. Her mind was less difficult to develop. She was a woman of mean understanding, little information, and uncertain temper. When she was discontented she fancied herself nervous. The business of her life was to get her daughters married; its solace was visiting and news.',
  ].join('\n');

  const defaultDesktopShowcaseMetaContent = JSON.stringify({
    title: "Default Desktop Showcase — Notepad Type, Maximise, OCR & Highlight",
    "needed-parameters": [
      { name: "fullText", label: "Full text to type into Notepad", default: defaultDesktopShowcaseText },
      { name: "textToHighlight", label: "Phrase to find via OCR and highlight", default: "must be in want of a wife" },
    ],
  }, null, 2);

  const defaultDesktopShowcaseRunContent = [
    'function log(msg) {',
    '  process.stdout.write(`${msg}\\n`);',
    '}',
    '',
    'function normalizeWord(s) {',
    '  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");',
    '}',
    '',
    'function findWordRunInOcr(ocrWords, target) {',
    '  const targetWords = target.trim().split(/\\s+/).map(normalizeWord).filter(Boolean);',
    '  if (targetWords.length === 0) return null;',
    '  for (let i = 0; i <= ocrWords.length - targetWords.length; i++) {',
    '    let matched = true;',
    '    for (let j = 0; j < targetWords.length; j++) {',
    '      if (normalizeWord(ocrWords[i + j].text) !== targetWords[j]) { matched = false; break; }',
    '    }',
    '    if (matched) {',
    '      return { firstWord: ocrWords[i], lastWord: ocrWords[i + targetWords.length - 1] };',
    '    }',
    '  }',
    '  return null;',
    '}',
    '',
    'module.exports = async function (driver, parameters = {}, zephyrLog) {',
    '  if (typeof zephyrLog !== "function") zephyrLog = function () {};',
    '  const fullText = parameters.fullText || "";',
    '  const targetText = parameters.textToHighlight || "";',
    '  if (!fullText.trim()) throw new Error("Parameter \'fullText\' is empty.");',
    '  if (!targetText.trim()) throw new Error("Parameter \'textToHighlight\' is empty.");',
    '',
    '  try {',
    '    log("Launching Notepad...");',
    '    await driver.launch("notepad.exe");',
    '    await driver.pause(2500);',
    '    zephyrLog("Launched Notepad.", "Pass");',
    '',
    '    log("Maximising Notepad window...");',
    '    await driver.focusWindow("Notepad");',
    '    await driver.pause(300);',
    '    await driver.maximizeWindow("Notepad");',
    '    await driver.pause(800);',
    '    zephyrLog("Maximised Notepad.", "Pass");',
    '',
    '    log("Typing passage into Notepad (this may take a minute)...");',
    '    const sendable = fullText.replace(/\\r\\n/g, "\\n").replace(/\\n/g, "{ENTER}");',
    '    const CHUNK = 400;',
    '    for (let i = 0; i < sendable.length; i += CHUNK) {',
    '      await driver.type(sendable.slice(i, i + CHUNK));',
    '      await driver.pause(80);',
    '    }',
    '    zephyrLog("Typed passage into Notepad.", "Pass");',
    '',
    '    log("Scrolling to top (Ctrl+Home)...");',
    '    await driver.keyPress("Ctrl", "Home");',
    '    await driver.pause(700);',
    '',
    '    log(`OCR: searching screen for "${targetText}"...`);',
    '    const ocr = await driver.readText();',
    '    if (!ocr || !Array.isArray(ocr.words) || ocr.words.length === 0) {',
    '      throw new Error("OCR returned no words — is Notepad visible and in focus?");',
    '    }',
    '    const match = findWordRunInOcr(ocr.words, targetText);',
    '    if (!match) {',
    '      throw new Error(`OCR did not find target phrase "${targetText}" on screen.`);',
    '    }',
    '    zephyrLog(`OCR located target phrase "${targetText}".`, "Pass");',
    '',
    '    const first = match.firstWord.bbox;',
    '    const last = match.lastWord.bbox;',
    '    const startX = first.x0 + 1;',
    '    const startY = Math.round((first.y0 + first.y1) / 2);',
    '    const endX = last.x1 - 1;',
    '    const endY = Math.round((last.y0 + last.y1) / 2);',
    '',
    '    log(`Click range start (${startX}, ${startY}) -> shift-click end (${endX}, ${endY})...`);',
    '    await driver.mouseClick(startX, startY);',
    '    await driver.pause(300);',
    '    await driver.shiftClick(endX, endY);',
    '    await driver.pause(500);',
    '    zephyrLog("Highlighted target phrase via click + shift-click range.", "Pass");',
    '  } catch (err) {',
    '    zephyrLog("FAIL: " + (err && err.message), "Fail");',
    '    throw err;',
    '  }',
    '};',
  ].join('\n');

  if (showStartupChecks) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "#f5f5f5", paddingTop: "20px" }}>
        <StartupChecks onDismiss={() => setShowStartupChecks(false)} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex" }}>
      <div style={{ flex: 1, minWidth: 0, padding: "20px", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "20px", marginBottom: "8px" }}>
          <h1 style={{ margin: 0, fontSize: "42px" }}>Marvin</h1>
          <img
            src="/img/marvin.png"
            alt="Marvin"
            style={{ height: "100px", width: "auto", objectFit: "contain" }}
            onError={(e) => { e.target.style.display = "none"; }}
          />
        </div>
        <div style={{
          textAlign: "center", margin: "0 auto 20px", maxWidth: "770px",
          height: "80px", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <p style={{
            fontStyle: "italic", color: "#888", fontSize: "18px", margin: 0,
            lineHeight: "1.4",
          }}>
            "{marvinQuotes[quoteIndex]}"
          </p>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "10px",
            marginBottom: "30px",
            flexWrap: "wrap",
          }}
        >
          <input
            type="text"
            placeholder="Enter GitHub Repo URL..."
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            style={{
              width: "500px",
              padding: "12px",
              fontSize: "16px",
              borderRadius: "5px",
              border: "1px solid #ccc",
            }}
          />
          <PATPopup open={patPopupOpen} onClose={() => setPatPopupOpen(false)} />
          <PrivateRepoCheckbox checked={privateRepo} onChange={setPrivateRepo} />
          <button
            onClick={handleClone}
            style={{
              padding: "12px 20px",
              fontSize: "16px",
              backgroundColor: theme.primary,
              color: theme.primaryText,
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
            }}
          >
            🔄 Refresh Tests
          </button>
          <button
            onClick={() => setSecretsOpen(s => !s)}
            style={{
              padding: "12px 20px",
              fontSize: "16px",
              backgroundColor: theme.primary,
              color: theme.primaryText,
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
            }}
          >
            {secretsOpen ? "Close Secrets" : "Open Secrets"}
          </button>
        </div>
        {secretsOpen && (
          <div style={{ margin: '32px auto', width: '700px', maxWidth: '95%' }}>
            <SecretsPanel />
          </div>
        )}
        {/* Logs Viewer */}
        <div
          style={{
            width: "100%", maxWidth: "1400px",
            margin: "30px auto",
            backgroundColor: "#fafafa",
            borderRadius: "10px",
            padding: "20px",
            border: "1px solid #ccc",
            boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
          }}
        >

          <button
            onClick={() => setIsServerLogExpanded((prev) => !prev)}
            style={{
              padding: "10px 20px",
              fontWeight: "bold",
              backgroundColor: theme.primary,
              color: theme.primaryText,
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
              marginBottom: "10px",
            }}
          >
            {isServerLogExpanded
              ? "Hide Server-side Test Logs"
              : "Show Server-side Test Logs"}
          </button>
          {isServerLogExpanded && (
            <div style={{ marginTop: "20px" }}>
              {Object.entries(serverSideLogs).map(([name, log]) => (
                <LogGroup
                  key={name}
                  title={name}
                  defaultCollapsed={name !== "[SEQUENCE]"}
                >
                  <pre
                    style={{
                      margin: 0,
                      padding: 15,
                      whiteSpace: "pre-wrap",
                      fontSize: "13px",
                    }}
                  >
                    {log || "No logs yet."}
                  </pre>
                </LogGroup>
              ))}
            </div>
          )}
        </div>
        {/* Schedule Panel */}
        <SchedulePanel
          sequencePayload={(() => {
            // Build the same payload that RunSequence sends
            const oktaUrls = {
              prod: "https://login.uts.edu.au",
              preprod: "https://login-preprod.uts.edu.au",
              test: "https://login-test.uts.edu.au",
            };
            const enriched = runSequence.map((t) => ({
              ...t,
              ...(testOptions[t.name] || {}),
            }));
            const wrapped = [];
            const envGroups = { prod: [], preprod: [], test: [] };
            const noOktaTests = [];
            for (const t of enriched) {
              if (t.oktaEnv && t.oktaEnv !== "none" && envGroups[t.oktaEnv]) {
                envGroups[t.oktaEnv].push(t);
              } else {
                noOktaTests.push(t);
              }
            }
            for (const [env, tests] of Object.entries(envGroups)) {
              if (tests.length > 0) {
                wrapped.push({ name: `OKTA Login (${env})`, builtin: "okta-login", oktaUrl: oktaUrls[env], visualBrowser: true });
                wrapped.push(...tests);
                wrapped.push({ name: `OKTA Finish (${env})`, builtin: "okta-login-finish", visualBrowser: true });
              }
            }
            wrapped.push(...noOktaTests);
            const simpleSeq = wrapped.map((step) => ({
              name: step.name,
              ...(step.zephyr ? { zephyr: step.zephyr } : {}),
              ...(step.builtin ? { builtin: step.builtin } : {}),
              ...(step.oktaUrl ? { oktaUrl: step.oktaUrl } : {}),
            }));
            const allParameters = {};
            for (const step of wrapped) {
              if (step.parameters && Object.keys(step.parameters).length > 0) {
                allParameters[step.name] = step.parameters;
              }
            }
            return { sequence: simpleSeq, parameters: allParameters, testType };
          })()}
          stepNames={runSequence.map((t) => t.name)}
        />
        {/* Test Type Toggle */}
        <div style={{ display: "flex", justifyContent: "center", margin: "24px 0 16px" }}>
          <div style={{
            display: "inline-flex",
            borderRadius: "8px",
            overflow: "hidden",
            border: `2px solid ${theme.primary}`,
          }}>
            <button
              onClick={() => setTestType("desktop")}
              style={{
                padding: "10px 24px",
                fontSize: "15px",
                fontWeight: "bold",
                border: "none",
                cursor: "pointer",
                backgroundColor: testType === "desktop" ? theme.primary : "#fff",
                color: testType === "desktop" ? theme.primaryText : theme.primary,
              }}
            >
              Desktop Tests
            </button>
            <button
              onClick={() => setTestType("web")}
              style={{
                padding: "10px 24px",
                fontSize: "15px",
                fontWeight: "bold",
                border: "none",
                borderLeft: `2px solid ${theme.primary}`,
                cursor: "pointer",
                backgroundColor: testType === "web" ? theme.primary : "#fff",
                color: testType === "web" ? theme.primaryText : theme.primary,
              }}
            >
              Web Tests
            </button>
          </div>
        </div>
        {/* Test cards */}
        {loading ? (
          <p style={{ textAlign: "center", fontStyle: "italic" }}>Loading tests...</p>
        ) : visibleTests.length === 0 ? (
          <>
            <div
              style={{
                width: "100%", maxWidth: "1400px",
                margin: "40px auto 0",
                backgroundColor: theme.primary,
                color: theme.primaryText,
                borderRadius: "10px",
                padding: "20px 40px",
                textAlign: "center",
                fontSize: "20px",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
              }}
            >
              No GitHub Tests Repo Loaded — Showing only default {testType === "desktop" ? "desktop" : "web"} test
            </div>
            {testType === "desktop" ? (
              <>
                <TestCard
                  key="__default-desktop-test"
                  name="__default-desktop-test"
                  runContent={defaultDesktopTestRunContent}
                  runFile="run.js"
                  metaContent={JSON.stringify({ title: "Default Desktop Test — Notepad Open/Type/Close - 3 Zephyr steps" }, null, 2)}
                  isInSequence={runSequence.some((t) => t.name === "__default-desktop-test")}
                  onToggleInSequence={(name, checked, flags) =>
                    handleToggleSequence(name, checked, { ...flags, builtin: "desktop-sample" })
                  }
                  onOptionsChange={handleOptionsChange}
                  results={testResults["__default-desktop-test"]}
                  testType={testType}
                />
                <TestCard
                  key="__default-desktop-showcase"
                  name="__default-desktop-showcase"
                  runContent={defaultDesktopShowcaseRunContent}
                  runFile="run.js"
                  metaContent={defaultDesktopShowcaseMetaContent}
                  isInSequence={runSequence.some((t) => t.name === "__default-desktop-showcase")}
                  onToggleInSequence={(name, checked, flags) =>
                    handleToggleSequence(name, checked, { ...flags, builtin: "desktop-showcase" })
                  }
                  onOptionsChange={handleOptionsChange}
                  results={testResults["__default-desktop-showcase"]}
                  testType={testType}
                />
              </>
            ) : (
              <TestCard
                key="__default-test"
                name="__default-test"
                runContent={defaultTestRunContent}
                runFile="run.js"
                metaContent={JSON.stringify({ title: "Default Test — UTS Course Handbook Logo Check - 1 Zephyr step" }, null, 2)}
                isInSequence={runSequence.some((t) => t.name === "__default-test")}
                onToggleInSequence={(name, checked, flags) =>
                  handleToggleSequence(name, checked, { ...flags, builtin: "default-test" })
                }
                onOptionsChange={handleOptionsChange}
                results={testResults["__default-test"]}
                testType={testType}
              />
            )}
          </>
        ) : (
          visibleTests.map((name) => (
            <TestCard
              key={name}
              name={name}
              runContent={files[name]?.run}
              runFile={files[name]?.runFile}
              metaContent={files[name]?.metadata}
              isInSequence={runSequence.some((t) => t.name === name)}
              onToggleInSequence={handleToggleSequence}
              onOptionsChange={handleOptionsChange}
              results={testResults[name]}
              testType={testType}
            />
          ))
        )}
      </div>
      {/* Execution sidebar */}
      <RunSequence
        sequence={runSequence.map((t) => ({
          ...t,
          ...(testOptions[t.name] || {}),
        }))}
        testType={testType}
        onTestResult={(name, options, onDone) =>
          handleRunTestViaWebSocket(name, testOptions[name], onDone)
        }
        onSequenceLog={handleSequenceLog}
        onBeforeRun={handleClearAllLogs}
      />
    </div>
  );
}
