//server/controllers/gitController.js
const fs = require("fs");
const path = require("path");
const simpleGit = require("simple-git");
const { CLONE_TARGET, TESTS_ROOT } = require("../utils/paths");
const TESTS_DIR = TESTS_ROOT;
// Helper to get secrets (using server/secrets.js)
const { getSecret } = require('../secrets');

function getPersonalAccessToken() {
  // 1. Try from environment variable (like the tests do)
  if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
    return process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  }
  // 2. Fallback to internal encrypted secrets datastore
  return getSecret("GITHUB_PERSONAL_ACCESS_TOKEN") || null;
}

function getGithubUsername() {
  if (process.env.GITHUB_USERNAME) {
    return process.env.GITHUB_USERNAME;
  }
  return getSecret("GITHUB_USERNAME") || null;
}

// Remove a directory, retrying through transient Windows locks (EBUSY/EPERM)
// that a just-finished test run can briefly hold on its artifacts.
function robustRemove(target) {
  if (!fs.existsSync(target)) return true;
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  } catch (err) {
    console.warn(`Could not fully remove ${target}: ${err.code || err.message}`);
  }
  return !fs.existsSync(target);
}

async function cloneTestRepo(req, res) {
  const { repoUrl, privateRepo } = req.body;
  const repoUrlClean = (repoUrl || "").trim();
  const isPrivate = privateRepo === true || privateRepo === "true" || privateRepo === 1;
  console.log("cloneTestRepo: repoUrl:", repoUrl, "privateRepo:", privateRepo, "isPrivate:", isPrivate);
  if (!repoUrl) {
    return res.status(400).json({ error: "Repository URL is required" });
  }
  try {
    let urlToClone = repoUrlClean;
    if (isPrivate) {
      const PAT = getPersonalAccessToken();
      const USER = getGithubUsername();
      if (!PAT) {
        console.log("PAT fail");
        return res.status(403).json({ error: "GITHUB_PERSONAL_ACCESS_TOKEN secret not set" });
      }
      if (!USER) {
        console.log("USERNAME fail");
        return res.status(403).json({ error: "GITHUB_USERNAME secret not set" });
      }
      let urlTail = repoUrlClean.replace(/^https:\/\//, "");
      urlToClone = `https://${encodeURIComponent(USER)}:${encodeURIComponent(PAT)}@${urlTail}`;
      console.log("CLONE (private):", urlToClone, "PAT found?", !!PAT, "username:", USER);
    } else {
      console.log("CLONE (public):", urlToClone);
    }
    const git = simpleGit();

    // Try to clear the existing repo folder. If a leftover test-run artifact is
    // still locked by the OS, clone into a fresh temp folder and swap it in so
    // the refresh does not fail outright.
    if (robustRemove(CLONE_TARGET)) {
      console.log(`Cloning ${urlToClone} into ${CLONE_TARGET}...`);
      await git.clone(urlToClone, CLONE_TARGET);
    } else {
      const tmpTarget = `${CLONE_TARGET}-new-${Date.now()}`;
      console.warn(`${CLONE_TARGET} is locked; cloning into ${tmpTarget} and swapping.`);
      await git.clone(urlToClone, tmpTarget);
      if (!robustRemove(CLONE_TARGET)) {
        robustRemove(tmpTarget);
        throw new Error(
          "The tests folder is locked by another process (e.g. a running test or antivirus). Close any running tests and try again."
        );
      }
      fs.renameSync(tmpTarget, CLONE_TARGET);
    }
    return res.json({ message: "Repo cloned successfully" });
  } catch (error) {
    console.error("❌ Failed to clone repo:", error);
    return res.status(500).json({ error: `Failed to clone repo: ${(error && error.message) || error}` });
  }
}

function listTests(req, res) {
  try {
    if (!fs.existsSync(TESTS_DIR)) {
      return res.status(404).json({ error: "No 'tests' folder found in the cloned repo" });
    }
    const testFolders = fs
      .readdirSync(TESTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    res.json(testFolders);
  } catch (error) {
    console.error("❌ Error reading test folders:", error);
    return res.status(500).json({ error: "Failed to read test folders" });
  }
}

function getTestFile(req, res) {
  const { testName, file } = req.params;
  const filePath = path.join(TESTS_DIR, testName, file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ content });
  } catch (error) {
    console.error(`❌ Failed to read file: ${filePath}`, error);
    return res.status(500).json({ error: "Error reading file" });
  }
}

module.exports = {
  cloneTestRepo,
  listTests,
  getTestFile,
};