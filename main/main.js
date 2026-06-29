// main/main.js — Electron main process
const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require("electron");
const path = require("path");
const { startBackend, stopBackend } = require("./backend-manager");

const isDev = !app.isPackaged;
const BACKEND_PORT = 5000;

let mainWindow;
let tray;

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
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Marvin",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/dist/index.html"));
  }

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Start the Express backend
  await startBackend(BACKEND_PORT);

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
