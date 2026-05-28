import express from "express";
import { readFileTool } from "../services/code-memory/tools.js";
import { hasValidHmacSignature } from "../services/security/hmac.js";

const router = express.Router();

router.post("/read-file", async (req, res) => {
  try {
    if (
      !hasValidHmacSignature({
        rawBody: req.rawBody,
        secret: process.env.CODE_SEARCH_HMAC_SECRET || "",
        signatureHeader: req.get("x-code-search-signature"),
      })
    ) {
      return res.status(401).json({
        success: false,
        ok: false,
        error: "bad_signature",
        detail: "Invalid code-search signature.",
      });
    }

    const result = await readFileTool(req.body || {});
    return res.json(result);
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || "read_file_failed";

    if (status >= 500) {
      console.error("read-file error:", error);
    }

    return res.status(status).json({
      success: false,
      ok: false,
      error: code,
      detail: error.message || "Unexpected server error",
    });
  }
});

export default router;
