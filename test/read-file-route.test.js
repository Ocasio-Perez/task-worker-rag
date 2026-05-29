import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "task-worker-rag-route-"));
process.env.REPO_ROOT = root;
process.env.CODE_SEARCH_HMAC_SECRET = "route-test-secret";

const { app } = await import("../task-worker.js");
const server = http.createServer(app);
let baseUrl;
let listenError;

test.before(async () => {
  await new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error.code === "EPERM" || error.code === "EACCES") {
        listenError = error;
        resolve();
        return;
      }
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
});

test("signed /api/read-file returns file content", async (t) => {
  if (skipIfNoListen(t)) return;
  await createRepo("hello-world", {
    "index.js": 'console.log("Hello world")\n',
  });

  const response = await signedPost("/api/read-file", {
    repo_name: "hello-world",
    relative_path: "index.js",
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.content, 'console.log("Hello world")\n');
});

test("signed /api/read-file rejects bad signature", async (t) => {
  if (skipIfNoListen(t)) return;
  const rawBody = JSON.stringify({
    repo_name: "hello-world",
    relative_path: "index.js",
  });

  const response = await fetch(`${baseUrl}/api/read-file`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-code-search-signature": "sha256=bad",
    },
    body: rawBody,
  });

  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error, "bad_signature");
});

test("signed /api/read-file rejects traversal", async (t) => {
  if (skipIfNoListen(t)) return;
  await createRepo("traversal", {
    "index.js": "ok\n",
  });

  const response = await signedPost("/api/read-file", {
    repo_name: "traversal",
    relative_path: "../outside.js",
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.error, "path_escape");
});

test("signed /api/read-file rejects ignored env files", async (t) => {
  if (skipIfNoListen(t)) return;
  await createRepo("secret-repo", {
    ".env": "TOKEN=secret\n",
  });

  const response = await signedPost("/api/read-file", {
    repo_name: "secret-repo",
    relative_path: ".env",
  });

  assert.equal(response.status, 415);
  assert.equal(response.body.error, "file_ignored");
});

async function signedPost(route, payload) {
  const rawBody = JSON.stringify(payload);
  const { createHmacSignature } = await import("../services/security/hmac.js");
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-code-search-signature": createHmacSignature(rawBody, process.env.CODE_SEARCH_HMAC_SECRET),
    },
    body: rawBody,
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

function skipIfNoListen(t) {
  if (!baseUrl) {
    t.skip(`local HTTP listen unavailable: ${listenError?.message || "unknown error"}`);
    return true;
  }
  return false;
}

async function createRepo(name, files) {
  const repoPath = path.join(root, name);
  await fs.mkdir(repoPath, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(repoPath, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
}
