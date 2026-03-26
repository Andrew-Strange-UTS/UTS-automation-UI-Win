// server/app.js

const express = require("express");
const http = require("http");
const cors = require("cors");
const { setupWebSocket } = require("./ws");

// Create Express app
const app = express();

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (Electron file://, curl, etc)
    if (!origin) return callback(null, true);
    // Allow localhost origins (Vite dev server, Electron)
    if (origin.startsWith("http://localhost") || origin.startsWith("file://")) {
      return callback(null, true);
    }
    // Allow configured origin
    const allowed = process.env.CORS_ORIGIN || "http://localhost:3000";
    if (origin === allowed) return callback(null, true);
    callback(null, true); // permissive for desktop app
  },
}));
app.use(express.json({ limit: "10mb" }));

// Routes
const gitRoutes = require("./routes/git");
const streamRoutes = require("./routes/stream");
const testsRoutes = require("./routes/tests");
const sequenceRoutes = require("./routes/sequence");
const secretsRoutes = require("./routes/secrets");
const schedulesRoutes = require("./routes/schedules");
const healthRoutes = require("./routes/health");

app.use("/api/git", gitRoutes);
app.use("/api/stream", streamRoutes);
app.use("/api/tests", testsRoutes);
app.use("/api/sequence", sequenceRoutes);
app.use("/api/secrets", secretsRoutes);
app.use("/api/schedules", schedulesRoutes);
app.use("/api/health", healthRoutes);

// Schedules are now managed by the standalone scheduler service
// (server/scheduler-service.js) — the routes proxy to it.

// Create HTTP server
const server = http.createServer(app);

// 🔌 Attach WebSocket server
setupWebSocket(server);

// Export the ready server to be run by index.js
module.exports = server;