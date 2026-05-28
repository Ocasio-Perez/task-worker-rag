#!/usr/bin/env node
import "dotenv/config";

import { Command } from "commander";
import { callReadFile } from "./callReadFile.js";

const program = new Command();

program
  .name("code-read")
  .description("Run a signed task-worker read-file request and print the file content.")
  .argument("<relative_path>", "repo-relative file path")
  .option("-r, --repo <name>", "repository name", process.env.REPO_NAME || process.env.CODE_REPO_NAME)
  .option("--max-bytes <count>", "maximum bytes to read", parsePositiveInt, 50_000)
  .option("--json", "print raw JSON response")
  .parse();

const options = program.opts();
const relativePath = program.args.join(" ").trim();

try {
  const response = await callReadFile({
    repoName: options.repo,
    relativePath,
    maxBytes: options.maxBytes,
  });

  if (options.json) {
    console.log(JSON.stringify(response.raw, null, 2));
    process.exit(0);
  }

  console.log(`${response.repoName}/${response.relativePath}`);
  console.log(
    `${response.bytes}/${response.totalBytes} bytes${response.truncated ? " (truncated)" : ""}`
  );
  console.log("");
  process.stdout.write(response.content);
  if (!response.content.endsWith("\n")) {
    process.stdout.write("\n");
  }
} catch (error) {
  console.error(`Read file failed: ${error.message}`);
  process.exit(1);
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--max-bytes must be a positive integer");
  }
  return parsed;
}
