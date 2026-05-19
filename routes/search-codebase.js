import express from "express";
import crypto from "crypto";
import { searchCodebase } from "../services/code-memory/search.js";

const router = express.Router();

function verifyCodeSearchSignature(req) {
  const secret = process.env.CODE_SEARCH_HMAC_SECRET || "";
  if (!secret) {
    return true;
  }

  const signatureHeader = req.get("x-code-search-signature");
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

router.post("/search-codebase", async (req, res) => {
  try {
    if (!verifyCodeSearchSignature(req)) {
      return res.status(401).json({
        success: false,
        error: "bad_signature",
        details: "Invalid code search signature.",
      });
    }

    const { query, n_results } = req.body || {};

    if (!query || typeof query !== "string") {
      return res.status(400).json({
        success: false,
        error: "query is required and must be a string",
      });
    }

    const results = await searchCodebase(query, n_results);

    return res.json({
      success: true,
      query,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error("search-codebase error:", error);
    return res.status(500).json({
      success: false,
      error: "codebase search failed",
      detail: error.message,
    });
  }
});

export default router;