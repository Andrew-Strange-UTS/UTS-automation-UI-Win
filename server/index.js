// server/index.js

const server = require("./app");

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Backend + WebSocket server running on http://localhost:${PORT}`);
  // Notify Electron main process that the server is ready
  if (process.send) process.send("ready");
});