// main/main.js — Electron main process
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, screen, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const {
  startBackend,
  stopBackend,
  getLastError,
  getLogPath,
} = require("./backend-manager");

// AC2: ensure the packaged Linux app also runs without the Chromium sandbox
// (previously this was only passed via the dev npm script).
if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
}

const isDev = !app.isPackaged;
const BACKEND_PORT = 5000;

// Splash/readiness tuning
const HEALTH_POLL_INTERVAL_MS = 300;
const HEALTH_TIMEOUT_MS = 15000;

// Defaults used when there is no valid saved window state
const DEFAULT_WINDOW_WIDTH = 1600;
const DEFAULT_WINDOW_HEIGHT = 900;

let mainWindow;
let splashWindow;
let tray;
let saveBoundsTimer = null;

// --- Window state persistence (AC5) ---------------------------------------

function getWindowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(getWindowStatePath(), "utf-8");
    const state = JSON.parse(raw);
    if (
      state &&
      Number.isFinite(state.width) &&
      Number.isFinite(state.height) &&
      state.width > 0 &&
      state.height > 0
    ) {
      return state;
    }
  } catch (err) {
    // No saved state, or it was unreadable/corrupt — fall back to defaults.
  }
  return null;
}

// Make sure the saved bounds land on a display that currently exists, so we
// don't restore the window onto a monitor that has been unplugged.
function isVisibleOnSomeDisplay(bounds) {
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false;
  try {
    const displays = screen.getAllDisplays();
    return displays.some((display) => {
      const wa = display.workArea;
      return (
        bounds.x < wa.x + wa.width &&
        bounds.x + bounds.width > wa.x &&
        bounds.y < wa.y + wa.height &&
        bounds.y + bounds.height > wa.y
      );
    });
  } catch (err) {
    return false;
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(bounds), "utf-8");
  } catch (err) {
    console.error("[window-state] Failed to save bounds:", err.message);
  }
}

function scheduleSaveWindowState() {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveWindowState, 500);
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, "../resources/icons/icon.ico");
    const image = nativeImage.createFromPath(iconPath);
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
    tray.setToolTip("Marvin");
    const menu = Menu.buildFromTemplate([
      {
        label: "Show Marvin",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
      }
    });
  } catch (err) {
    console.error("[tray] Failed to create system tray:", err.message);
  }
}

function createWindow() {
  // AC5: restore saved bounds if they are valid and on a visible display,
  // otherwise default to 1600x900 centered.
  const saved = loadWindowState();
  const useSaved = saved && isVisibleOnSomeDisplay(saved);

  const windowOptions = {
    width: useSaved ? saved.width : DEFAULT_WINDOW_WIDTH,
    height: useSaved ? saved.height : DEFAULT_WINDOW_HEIGHT,
    minWidth: 1200,
    minHeight: 700,
    title: "Marvin",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  if (useSaved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    windowOptions.x = saved.x;
    windowOptions.y = saved.y;
  } else {
    windowOptions.center = true;
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/dist/index.html"));
  }

  // Reveal the window only once content is painted, and tear down the splash.
  mainWindow.once("ready-to-show", () => {
    destroySplash();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // AC5: persist bounds across restarts.
  mainWindow.on("resize", scheduleSaveWindowState);
  mainWindow.on("move", scheduleSaveWindowState);
  mainWindow.on("close", saveWindowState);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// --- Splash screen (AC4) ---------------------------------------------------

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    skipTaskbar: true,
    title: "Marvin",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function destroySplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy();
  }
  splashWindow = null;
}

// Poll the backend health endpoint until it responds OK or we time out.
function waitForBackendHealth() {
  const url = `http://localhost:${BACKEND_PORT}/api/health`;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;

  return new Promise((resolve) => {
    const attempt = async () => {
      try {
        const res = await fetch(url, { method: "GET" });
        if (res.ok) {
          resolve(true);
          return;
        }
      } catch (err) {
        // Backend not up yet — keep polling until the deadline.
      }
      if (Date.now() >= deadline) {
        console.warn("[health] Backend health check timed out; showing UI anyway.");
        resolve(false);
        return;
      }
      setTimeout(attempt, HEALTH_POLL_INTERVAL_MS);
    };
    attempt();
  });
}

// Tell the user why the backend is unavailable, and where to look. Offer to
// open the log, since that is the first thing anyone will be asked for.
function reportBackendFailure() {
  const logPath = getLogPath();
  const reason = getLastError() || "The backend did not become available.";

  destroySplash();

  const { response } = dialog.showMessageBoxSync
    ? { response: dialog.showMessageBoxSync({
        type: "error",
        title: "Marvin — backend did not start",
        message: "Marvin's backend did not start, so most features will not work.",
        detail: `${reason}\n\nFull log:\n${logPath}`,
        buttons: ["Open log folder", "Continue anyway"],
        defaultId: 0,
        cancelId: 1,
      }) }
    : { response: 1 };

  if (response === 0) {
    shell.showItemInFolder(logPath);
  }
}

app.whenReady().then(async () => {
  // Show the splash immediately so the user has feedback while we start up.
  createSplash();

  // Start the Express backend
  const started = await startBackend(BACKEND_PORT);

  // Additional readiness gate: wait for the health endpoint (bounded timeout).
  const healthy = await waitForBackendHealth();

  // Without this the app opens to a generic "backend not found" and the real
  // reason sits in a console that a packaged app does not have.
  if (!started || !healthy) {
    reportBackendFailure();
  }

  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopBackend();
  app.quit();
});

app.on("before-quit", () => {
  stopBackend();
});
