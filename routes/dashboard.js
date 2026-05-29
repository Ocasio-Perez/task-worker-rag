import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getCodeMemoryStatus,
  listCodeRepos,
} from "../services/code-memory/status.js";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardDist = path.resolve(__dirname, "../dashboard/dist");

router.get("/api/dashboard/status", async (req, res) => {
  try {
    const status = await getCodeMemoryStatus({
      repoName: req.query.repo_name || "",
      taskWorkerUrl: `${req.protocol}://${req.get("host")}`,
    });
    res.json(status);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "dashboard_status_failed",
      detail: error.message,
    });
  }
});

router.get("/api/dashboard/repos", async (_req, res) => {
  try {
    const repos = await listCodeRepos({ includeIndex: true });
    res.json({
      ok: true,
      repos,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "dashboard_repos_failed",
      detail: error.message,
    });
  }
});

router.use("/dashboard", express.static(dashboardDist));

router.get(/^\/dashboard(?:\/.*)?$/, (_req, res) => {
  res.sendFile(path.join(dashboardDist, "index.html"));
});

export default router;
