import "dotenv/config";

import express from "express";
import crypto from "crypto";
import searchCodebaseRouter from "./routes/search-codebase.js";

const app = express();
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 9000);
const AGENT_NAME = process.env.AGENT_NAME || "your_agent_name";

const HERMES_SECRET = process.env.HERMES_SECRET || "";
const OPENCLAW_SECRET = process.env.OPENCLAW_SECRET || "";

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

const seenTaskIds = new Set();
const routeTable = new Map();

app.use("/api", searchCodebaseRouter);

app.get("/", (_req, res) => {
  res.send("Server is running");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: AGENT_NAME,
  });
});

app.post("/task", async (req, res) => {
  try {
    if (!verifySignature(req, HERMES_SECRET, req.get("x-hermes-signature"))) {
      return res.status(401).json({
        task_id: null,
        agent: AGENT_NAME,
        status: "error",
        summary: "Unauthorized",
        details: "Invalid Hermes signature.",
        error: "bad_signature",
      });
    }

    const payload = req.body;

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({
        task_id: null,
        agent: AGENT_NAME,
        status: "error",
        summary: "No task payload received",
        details:
          "The request requires a structured JSON task from Hermes. No task was provided.",
        error: "missing_task_payload",
      });
    }

    const {
      task_id = crypto.randomUUID(),
      conversation_id = crypto.randomUUID(),
      goal = null,
      context = {},
      constraints = {},
      expected_output = {},
    } = payload;

    if (!goal || typeof goal !== "string") {
      return res.status(400).json({
        task_id,
        agent: AGENT_NAME,
        status: "error",
        summary: "Missing goal",
        details: "The task payload must include a string field named goal.",
        error: "missing_goal",
      });
    }

    if (seenTaskIds.has(task_id)) {
      return res.status(200).json({
        task_id,
        agent: AGENT_NAME,
        status: "duplicate",
        summary: "Task already received",
        details: "This task_id has already been processed or accepted.",
        error: null,
      });
    }

    seenTaskIds.add(task_id);

    const envelope = {
      task_id,
      conversation_id,
      agent: AGENT_NAME,
      sender: "hermes",
      target: "openclaw",
      goal,
      context,
      constraints,
      expected_output,
      trace_id: req.get("x-request-id") || crypto.randomUUID(),
      received_at: new Date().toISOString(),
    };

    routeTable.set(task_id, {
      conversation_id,
      source: "hermes",
      status: "accepted",
      created_at: envelope.received_at,
    });

    await forwardToOpenClaw(envelope);

    return res.status(202).json({
      task_id,
      agent: AGENT_NAME,
      status: "accepted",
      summary: `Accepted delegated task: ${goal}`,
      details: {
        conversation_id,
        received_context_keys: Object.keys(context).sort(),
        tools_allowed: Array.isArray(constraints.tools_allowed)
          ? constraints.tools_allowed
          : [],
        timeout_sec: constraints.timeout_sec ?? 60,
        expected_format: expected_output.format ?? "json",
      },
      error: null,
    });
  } catch (err) {
    return res.status(500).json({
      task_id: req.body?.task_id ?? null,
      agent: AGENT_NAME,
      status: "error",
      summary: "Failed to process task",
      details: err.message || "Unexpected server error",
      error: "task_processing_failed",
    });
  }
});

app.post("/result", async (req, res) => {
  try {
    if (
      !verifySignature(req, OPENCLAW_SECRET, req.get("x-openclaw-signature"))
    ) {
      return res.status(401).json({
        task_id: null,
        agent: AGENT_NAME,
        status: "error",
        summary: "Unauthorized",
        details: "Invalid OpenClaw signature.",
        error: "bad_signature",
      });
    }

    const payload = req.body;

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({
        task_id: null,
        agent: AGENT_NAME,
        status: "error",
        summary: "No result payload received",
        details:
          "The request requires a structured JSON result from OpenClaw. No result was provided.",
        error: "missing_result_payload",
      });
    }

    const {
      task_id = null,
      conversation_id = null,
      status = "ok",
      summary = "Result received",
      details = {},
      error = null,
    } = payload;

    if (!task_id || typeof task_id !== "string") {
      return res.status(400).json({
        task_id: null,
        agent: AGENT_NAME,
        status: "error",
        summary: "Missing task_id",
        details: "The result payload must include a string field named task_id.",
        error: "missing_task_id",
      });
    }

    const existingRoute = routeTable.get(task_id);

    if (!existingRoute) {
      return res.status(404).json({
        task_id,
        agent: AGENT_NAME,
        status: "error",
        summary: "Unknown task_id",
        details: "No matching delegated task was found for this result.",
        error: "unknown_task_id",
      });
    }

    const resultEnvelope = {
      task_id,
      conversation_id: conversation_id || existingRoute.conversation_id,
      agent: AGENT_NAME,
      sender: "openclaw",
      target: "hermes",
      status,
      summary,
      details,
      error,
      trace_id: req.get("x-request-id") || crypto.randomUUID(),
      received_at: new Date().toISOString(),
    };

    existingRoute.status = status;
    existingRoute.last_result_at = resultEnvelope.received_at;
    routeTable.set(task_id, existingRoute);

    await forwardToHermes(resultEnvelope);

    return res.status(202).json({
      task_id,
      agent: AGENT_NAME,
      status: "accepted",
      summary: "OpenClaw result accepted for relay to Hermes",
      details: {
        conversation_id: resultEnvelope.conversation_id,
        relayed_status: status,
      },
      error: null,
    });
  } catch (err) {
    return res.status(500).json({
      task_id: req.body?.task_id ?? null,
      agent: AGENT_NAME,
      status: "error",
      summary: "Failed to process result",
      details: err.message || "Unexpected server error",
      error: "result_processing_failed",
    });
  }
});

function verifySignature(req, secret, signatureHeader) {
  if (!secret) {
    return true;
  }

  if (!req.rawBody || !signatureHeader) {
    return false;
  }

  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("hex")}`;

  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");

  return (
    expectedBuf.length === actualBuf.length &&
    crypto.timingSafeEqual(expectedBuf, actualBuf)
  );
}

async function forwardToOpenClaw(envelope) {
  const url =
    process.env.OPENCLAW_URL ||
    "http://127.0.0.1:18789/v1/chat/completions";
  const apiKey = process.env.OPENCLAW_API_KEY || "";

  if (!apiKey) {
    throw new Error("OPENCLAW_API_KEY is not set");
  }

  const body = JSON.stringify({
    model: "openclaw/default",
    messages: [
      {
        role: "system",
        content:
          "You are OpenClaw receiving a delegated task from Hermes through task-worker. " +
          "Read the provided JSON payload, execute the task, and respond concisely.",
      },
      {
        role: "user",
        content: JSON.stringify({
          task_id: envelope.task_id,
          conversation_id: envelope.conversation_id,
          goal: envelope.goal,
          context: envelope.context,
          constraints: envelope.constraints,
          expected_output: envelope.expected_output,
          metadata: {
            trace_id: envelope.trace_id,
            received_at: envelope.received_at,
          },
        }),
      },
    ],
    stream: false,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `OpenClaw forward failed with status ${response.status}: ${text}`
    );
  }

  const json = await response.json().catch(() => ({ ok: true }));

  const completionText =
    json?.choices?.[0]?.message?.content ||
    "OpenClaw completed the delegated task";

  const existingRoute = routeTable.get(envelope.task_id) || {};
  existingRoute.status = "ok";
  existingRoute.last_result_at = new Date().toISOString();
  routeTable.set(envelope.task_id, existingRoute);

  await forwardToHermes({
    task_id: envelope.task_id,
    conversation_id: envelope.conversation_id,
    status: "ok",
    summary: "OpenClaw completed the delegated task",
    details: {
      openclaw_response: completionText,
      raw_openclaw: json,
    },
    error: null,
    trace_id: envelope.trace_id,
  });

  return json;
}

async function forwardToHermes(envelope) {
  const hermesUrl =
    process.env.HERMES_WEBHOOK_URL ||
    "http://127.0.0.1:8644/webhooks/task-worker-result";

  const hermesSecret = process.env.HERMES_WEBHOOK_SECRET || "";

  const body = JSON.stringify({
    task_id: envelope.task_id,
    conversation_id: envelope.conversation_id,
    status: envelope.status || "ok",
    summary: envelope.summary || "OpenClaw completed the delegated task",
    details: envelope.details || {},
    error: envelope.error ?? null,
  });

  const headers = {
    "content-type": "application/json",
    "x-request-id":
      envelope.trace_id || envelope.task_id || crypto.randomUUID(),
  };

  if (hermesSecret) {
    const digest = crypto
      .createHmac("sha256", hermesSecret)
      .update(body)
      .digest("hex");
    headers["x-webhook-signature"] = digest;
  }

  const response = await fetch(hermesUrl, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Hermes forward failed with status ${response.status}: ${text}`
    );
  }

  return await response.json().catch(() => ({ ok: true }));
}

app.listen(PORT, HOST, () => {
  console.log(`${AGENT_NAME} listening on http://${HOST}:${PORT}`);
});