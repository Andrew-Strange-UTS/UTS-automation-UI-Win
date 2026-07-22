// server/index.js

const server = require("./app");

// PORT 0 lets the OS assign a free port. A shared VM runs one backend per
// logged-in user, so a fixed port collides for the second user. The actual
// port is read back after listen and reported to the Electron main process.
const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 0;

server.listen(PORT, () => {
  const actualPort = server.address().port;
  console.log(`Backend + WebSocket server running on http://localhost:${actualPort}`);
  // Notify Electron main process that the server is ready, and on which port.
  if (process.send) process.send({ type: "ready", port: actualPort });
});