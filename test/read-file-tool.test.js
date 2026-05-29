import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "task-worker-rag-test-"));
process.env.REPO_ROOT = root;

const { readFileTool } = await import("../services/code-memory/tools.js");

test.after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("readFileTool reads repo-confined files", async () => {
  const repoPath = await createRepo("hello-world", {
    "index.js": 'console.log("Hello world")\n',
  });

  const result = await readFileTool({
    repo_name: "hello-world",
    relative_path: "index.js",
  });

  assert.equal(result.ok, true);
  assert.equal(result.repo_path, repoPath);
  assert.equal(result.relative_path, "index.js");
  assert.equal(result.content, 'console.log("Hello world")\n');
});

test("readFileTool rejects path traversal", async () => {
  await createRepo("path-traversal", {
    "index.js": "ok\n",
  });

  await assert.rejects(
    readFileTool({
      repo_name: "path-traversal",
      relative_path: "../outside.js",
    }),
    { code: "path_escape", status: 403 }
  );
});

test("readFileTool rejects ignored directories", async () => {
  await createRepo("ignored-dir", {
    "node_modules/pkg/index.js": "module.exports = true;\n",
  });

  await assert.rejects(
    readFileTool({
      repo_name: "ignored-dir",
      relative_path: "node_modules/pkg/index.js",
    }),
    { code: "directory_ignored", status: 415 }
  );
});

test("readFileTool rejects secret env files", async () => {
  await createRepo("env-file", {
    ".env": "TOKEN=secret\n",
  });

  await assert.rejects(
    readFileTool({
      repo_name: "env-file",
      relative_path: ".env",
    }),
    { code: "file_ignored", status: 415 }
  );
});

test("readFileTool rejects symlinks that escape repo", async (t) => {
  const repoPath = await createRepo("symlink-escape", {});
  const outsidePath = path.join(root, "outside.js");
  await fs.writeFile(outsidePath, "outside\n");

  try {
    await fs.symlink(outsidePath, path.join(repoPath, "outside.js"));
  } catch (error) {
    t.skip(`symlink unavailable: ${error.message}`);
    return;
  }

  await assert.rejects(
    readFileTool({
      repo_name: "symlink-escape",
      relative_path: "outside.js",
    }),
    { code: "path_escape", status: 403 }
  );
});

async function createRepo(name, files) {
  const repoPath = path.join(root, name);
  await fs.mkdir(repoPath, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(repoPath, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }

  return repoPath;
}
