// main/preload.js — Secure bridge between renderer and main process
const { contextBridge, ipcRenderer } = require("electron");

// The main process passes the backend's actual port via additionalArguments.
// The backend binds a free port at runtime, so this is how the renderer learns
// which one, rather than assuming a fixed 5000.
function readArg(prefix) {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}
const backendPortArg = readArg("--backend-port=");
const backendPort = backendPortArg ? Number(backendPortArg) : null;

contextBridge.exposeInMainWorld("electronAPI", {
  // Expose any Electron-specific APIs here as needed
  platform: process.platform,
  isElectron: true,
  backendPort,
});
