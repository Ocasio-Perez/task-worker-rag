#!/usr/bin/env bash
set -euo pipefail

TASK_WORKER_RAG_DIR="${TASK_WORKER_RAG_DIR:-$HOME/Development/task-worker-rag}"

if [[ $# -lt 2 ]]; then
  echo "Usage: code-read <repo_name> <relative_path> [max_bytes]" >&2
  exit 2
fi

repo_name="$1"
relative_path="$2"
max_bytes="${3:-50000}"

cd "$TASK_WORKER_RAG_DIR"
npm run code-read -- --repo "$repo_name" --max-bytes "$max_bytes" "$relative_path"
