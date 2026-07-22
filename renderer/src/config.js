// renderer/src/config.js
// The backend binds a free port at runtime (a shared VM runs one backend per
// user, so a fixed port collides for the second user). The main process passes
// the actual port through preload as window.electronAPI.backendPort.

function resolveBackendPort() {
  if (typeof window !== "undefined" && window.electronAPI && window.electronAPI.backendPort) {
    return window.electronAPI.backendPort;
  }
  // Fallback for a standalone browser / dev without Electron. Not used in the
  // packaged app, where the port is always injected.
  return 5000;
}

const PORT = resolveBackendPort();

export const BACKEND_URL = `http://localhost:${PORT}`;
export const WS_URL = `ws://localhost:${PORT}`;
