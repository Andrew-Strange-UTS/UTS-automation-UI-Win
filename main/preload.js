// main/preload.js — Secure bridge between renderer and main process
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Expose any Electron-specific APIs here as needed
  platform: process.platform,
  isElectron: true,
});
