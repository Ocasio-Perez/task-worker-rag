#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hermes_home="${HERMES_HOME:-$HOME/.hermes}"
systemd_user_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
hermes_config="$hermes_home/config.yaml"
hermes_env="$systemd_user_dir/hermes-gateway.env"

usage() {
  cat <<EOF
Usage: scripts/install-hermes-integration.sh [--with-systemd] [--restart-hermes]

Installs the Hermes task-worker code tools plugin and local helper scripts.

Options:
  --with-systemd     Install task-worker-rag systemd unit/env templates.
  --restart-hermes   Restart hermes-gateway.service after plugin install.
  -h, --help         Show this help.
EOF
}

with_systemd=0
restart_hermes=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-systemd) with_systemd=1 ;;
    --restart-hermes) restart_hermes=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

echo "Installing Hermes task-worker integration from: $repo_dir"

mkdir -p "$hermes_home/plugins/task-worker-code-tools"
cp -R "$repo_dir/integrations/hermes/plugins/task-worker-code-tools/." \
  "$hermes_home/plugins/task-worker-code-tools/"
echo "Installed plugin: $hermes_home/plugins/task-worker-code-tools"

mkdir -p "$hermes_home/quick-commands"
cp "$repo_dir/integrations/hermes/quick-commands/code-read.sh" "$hermes_home/quick-commands/code-read"
cp "$repo_dir/integrations/hermes/quick-commands/code-search.sh" "$hermes_home/quick-commands/code-search"
chmod +x "$hermes_home/quick-commands/code-read" "$hermes_home/quick-commands/code-search"
echo "Installed helper scripts: $hermes_home/quick-commands"

if [[ -f "$hermes_config" ]]; then
  if grep -Eq '^[[:space:]]*-[[:space:]]*task-worker-code-tools[[:space:]]*$' "$hermes_config"; then
    echo "Hermes config enables task-worker-code-tools."
  else
    cat <<EOF
WARNING: $hermes_config does not appear to enable task-worker-code-tools.
Add:

plugins:
  enabled:
    - task-worker-code-tools
EOF
  fi
else
  echo "WARNING: Hermes config not found: $hermes_config"
fi

if [[ -f "$hermes_env" ]]; then
  if grep -Eq '^CODE_SEARCH_HMAC_SECRET=.+' "$hermes_env"; then
    echo "Hermes env has CODE_SEARCH_HMAC_SECRET."
  else
    echo "WARNING: $hermes_env is missing CODE_SEARCH_HMAC_SECRET."
  fi
else
  echo "NOTE: Hermes env file not found at $hermes_env."
fi

if [[ $with_systemd -eq 1 ]]; then
  mkdir -p "$systemd_user_dir"
  cp "$repo_dir/deploy/systemd/task-worker-rag.service" "$systemd_user_dir/task-worker-rag.service"
  cp "$repo_dir/deploy/systemd/code-memory-reindex@.service" "$systemd_user_dir/code-memory-reindex@.service"
  cp "$repo_dir/deploy/systemd/code-memory-reindex@.timer" "$systemd_user_dir/code-memory-reindex@.timer"
  if [[ ! -f "$systemd_user_dir/task-worker-rag.env" ]]; then
    cp "$repo_dir/deploy/systemd/task-worker-rag.env.example" "$systemd_user_dir/task-worker-rag.env"
    echo "Created env template: $systemd_user_dir/task-worker-rag.env"
    echo "Edit secrets before starting task-worker-rag.service."
  else
    echo "Env file already exists: $systemd_user_dir/task-worker-rag.env"
  fi
  systemctl --user daemon-reload
  echo "Installed systemd units: task-worker-rag.service, code-memory-reindex@.service, code-memory-reindex@.timer"
fi

if [[ $restart_hermes -eq 1 ]]; then
  systemctl --user restart hermes-gateway.service
  echo "Restarted hermes-gateway.service"
fi

cat <<EOF

Next:
1. Ensure ~/.hermes/config.yaml includes:

plugins:
  enabled:
    - task-worker-code-tools

2. Ensure Hermes and task-worker share CODE_SEARCH_HMAC_SECRET.
3. Test:

/code-help
/code-status
/code-read hello-world index.js
/code-search hello-world "Hello world" 5
EOF
