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

async function cloneTestRepo(req, res) {
  const { repoUrl, privateRepo } = req.body;
  const repoUrlClean = (repoUrl || "").trim();
  const isPrivate = privateRepo === true || privateRepo === "true" || privateRepo === 1;
  console.log("cloneTestRepo: repoUrl:", repoUrl, "privateRepo:", privateRepo, "isPrivate:", isPrivate);
  if (!repoUrl) {
    return res.status(400).json({ error: "Repository URL is required" });
  }
  try {
    if (fs.existsSync(CLONE_TARGET)) {
      fs.rmSync(CLONE_TARGET, { recursive: true, force: true });
    }
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
    console.log(`Cloning ${urlToClone} into ${CLONE_TARGET}...`);
    await git.clone(urlToClone, CLONE_TARGET);
    return res.json({ message: "Repo cloned successfully" });
  } catch (error) {
    console.error("❌ Failed to clone repo:", error);
    return res.status(500).json({ error: "Failed to clone repo" });
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