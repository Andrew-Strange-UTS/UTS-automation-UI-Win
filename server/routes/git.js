//server/routes/git.js

const express = require("express");
const router = express.Router();

const {
  cloneTestRepo,
  listTests,
  getTestFile,
} = require("../controllers/gitController");

// POST /api/git/clone → clone the repo to tmp/repo
router.post("/clone", cloneTestRepo);

// GET /api/git/list → list folders under /tests
router.get("/list", listTests);

// GET /api/git/:testName/:file → get run.js or metadata.json for test
router.get("/:testName/:file", getTestFile);

module.exports = router;