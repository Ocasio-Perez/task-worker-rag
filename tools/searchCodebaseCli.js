#!/usr/bin/env node
import "dotenv/config";

import { Command } from "commander";
import Table from "cli-table3";
import { callCodeSearch } from "./callCodeSearch.js";

const program = new Command();

program
  .name("code-search")
  .description("Run a signed task-worker code search and print readable results.")
  .argument("<query>", "search query")
  .option("-r, --repo <name>", "repository name", process.env.REPO_NAME || process.env.CODE_REPO_NAME)
  .option("-n, --num <count>", "number of results", parsePositiveInt, 5)
  .option("--content", "include full chunk content")
  .option("--json", "print raw JSON response")
  .parse();

const options = program.opts();
const query = program.args.join(" ").trim();

try {
  const response = await callCodeSearch({
    query,
    repoName: options.repo,
    nResults: options.num,
    includeContent: Boolean(options.content),
  });

  if (options.json) {
    console.log(JSON.stringify(response.raw, null, 2));
    process.exit(0);
  }

  printReadableResults(response, { includeContent: Boolean(options.content) });
} catch (error) {
  console.error(`Code search failed: ${error.message}`);
  process.exit(1);
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--num must be a positive integer");
  }
  return parsed;
}

function printReadableResults(response, { includeContent }) {
  console.log(response.raw?.summary || `Found ${response.count} result(s)`);
  console.log(`Query: ${response.query}`);
  console.log(`Request: ${response.requestId}`);
  console.log("");

  if (!response.results.length) {
    console.log("No matching chunks found.");
    return;
  }

  const table = new Table({
    head: ["#", "Distance", "Chunk", "File", "Preview"],
    colWidths: [4, 10, 8, 36, 80],
    wordWrap: true,
  });

  response.results.forEach((result, index) => {
    table.push([
      index + 1,
      formatDistance(result.distance),
      result.chunk ?? "",
      result.file || result.fullPath || "",
      result.preview || "",
    ]);
  });

  console.log(table.toString());

  if (!includeContent) return;

  for (const [index, result] of response.results.entries()) {
    console.log("");
    console.log(`#${index + 1} ${result.file || result.fullPath || ""}`);
    console.log("-".repeat(80));
    console.log(result.content || result.preview || "");
  }
}

function formatDistance(value) {
  if (typeof value !== "number") return "";
  return value.toFixed(4);
}
