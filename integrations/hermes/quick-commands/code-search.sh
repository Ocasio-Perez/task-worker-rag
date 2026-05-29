#!/usr/bin/env bash
set -euo pipefail

TASK_WORKER_RAG_DIR="${TASK_WORKER_RAG_DIR:-$HOME/Development/task-worker-rag}"

if [[ $# -lt 2 ]]; then
  echo "Usage: code-search <repo_name> <query> [n_results]" >&2
  exit 2
fi

repo_name="$1"
query="$2"
n_results="${3:-5}"

cd "$TASK_WORKER_RAG_DIR"
npm run code-search -- --repo "$repo_name" --num "$n_results" "$query"
