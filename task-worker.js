const express = require("express");

const app = express();
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 9000);
const AGENT_NAME = process.env.AGENT_NAME || "your_agent_name";

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Server is running');
});

app.post("/task", (req, res) => {
  const payload = req.body;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return res.status(400).json({
      task_id: null,
      agent: `${AGENT_NAME}`,
      status: "error",
      summary: "No task payload received",
      details: "The request requires a structured JSON task from Hermes. No task was provided.",
      error: "missing_task_payload"
    });
  }

  const { task_id = null, goal = null, context = {}, constraints = {}, expected_output = {} } = payload;

  if (!goal || typeof goal !== "string") {
    return res.status(400).json({
      task_id,
      agent: `${AGENT_NAME}`,
      status: "error",
      summary: "Missing goal",
      details: "The task payload must include a string field named goal.",
      error: "missing_goal"
    });
  }

  return res.json({
    task_id,
    agent: `${AGENT_NAME}`,
    status: "ok",
    summary: `Accepted delegated task: ${goal}`,
    details: {
      received_context_keys: Object.keys(context).sort(),
      tools_allowed: Array.isArray(constraints.tools_allowed) ? constraints.tools_allowed : [],
      timeout_sec: constraints.timeout_sec ?? 60,
      expected_format: expected_output.format ?? "json"
    },
    error: null
  });
});

app.listen(PORT, HOST, () => {
  console.log(` ${AGENT_NAME} listening on http://${HOST}:${PORT}`);
});
