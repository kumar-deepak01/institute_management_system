"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const root = path.resolve(__dirname, '..');
const run = promisify(execFile);
const ignoredRoots = new Set(["node_modules", ".git", "data", "uploads"]);
const ignoredPaths = ["server/data", "server/uploads", "server/.tmp", "client/node_modules", "server/node_modules"];
let debounceTimer = null;
let pushing = false;
let pendingChange = false;

function isIgnored(filename) {
  const relative = String(filename || "").replace(/\\/g, "/");
  return ignoredRoots.has(relative.split("/")[0]) || ignoredPaths.some(rootPath => relative === rootPath || relative.startsWith(`${rootPath}/`));
}

async function git(args) {
  try { return await run("git", args, { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024 }); }
  catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || "Unknown Git error").trim();
    throw Object.assign(new Error(detail), { code: error.code });
  }
}

async function hasStagedChanges() {
  try { await git(["diff", "--cached", "--quiet"]); return false; }
  catch (error) { if (error.code === 1) return true; throw error; }
}

async function pushChanges() {
  if (pushing) { pendingChange = true; return; }
  pushing = true;
  try {
    await git(["add", "-A"]);
    if (!(await hasStagedChanges())) { console.log("Auto-push: no changes to commit."); return; }
    const timestamp = new Date().toLocaleString();
    await git(["commit", "-m", `Auto update ${timestamp}`]);
    await git(["pull", "--rebase"]);
    await git(["push"]);
    console.log("Auto-push: commit pushed successfully.");
  } catch (error) {
    try { await git(["rebase", "--abort"]); } catch { /* No rebase is active or abort has already restored the branch. */ }
    console.error(`Auto-push stopped: ${error.message}`);
  } finally {
    pushing = false;
    if (pendingChange) { pendingChange = false; schedulePush(); }
  }
}

function schedulePush() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(pushChanges, 15000);
}

const watcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
  if (!isIgnored(filename)) schedulePush();
});
watcher.on("error", error => { console.error(`Auto-push watcher stopped: ${error.message}`); process.exitCode = 1; });
console.log("Auto-push is watching project files. Changes are pushed after 15 seconds of inactivity.");
