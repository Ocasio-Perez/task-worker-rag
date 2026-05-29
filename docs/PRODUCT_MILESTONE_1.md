# Product Milestone 1: Install And Status

This milestone turns the Hermes code-memory integration into a repeatable local
developer-tool workflow.

## What This Provides

- install/update script for the Hermes plugin
- Hermes-native slash commands:
  - `/code-help`
  - `/code-status`
  - `/code-repos`
  - `/code-sync`
  - `/code-read`
  - `/code-search`
- task-worker systemd unit and env templates
- shared env template
- operator status command:
  - `npm run code-status`

## Install Or Update Hermes Integration

On the WSL machine where Hermes runs:

```bash
cd ~/Development/task-worker-rag
git pull --ff-only origin main
npm install

./scripts/install-hermes-integration.sh --restart-hermes
```

If installing the task-worker systemd unit for the first time:

```bash
./scripts/install-hermes-integration.sh --with-systemd --restart-hermes
```

Then edit:

```text
~/.config/systemd/user/task-worker-rag.env
```

Set real values for:

- `CODE_SEARCH_HMAC_SECRET`
- `HERMES_SECRET`
- `OPENCLAW_SECRET`

Enable/start task-worker:

```bash
systemctl --user daemon-reload
systemctl --user enable --now task-worker-rag.service
```

## Hermes Config

Ensure `~/.hermes/config.yaml` enables the plugin:

```yaml
plugins:
  enabled:
    - task-worker-code-tools
```

Ensure the Hermes gateway environment has the same
`CODE_SEARCH_HMAC_SECRET` as task-worker. See:

```text
deploy/systemd/hermes-code-tools.env.example
```

Restart Hermes after changing plugin files or environment:

```bash
systemctl --user restart hermes-gateway.service
```

## Status Checks

Operator status from the repo:

```bash
cd ~/Development/task-worker-rag
npm run code-status
npm run code-status -- hello-world
npm run code-status -- hello-world --json
```

Hermes status:

```text
/code-help
/code-status
```

The repo-level status checks:

- task-worker `/health`
- Ollama `/api/tags`
- ChromaDB heartbeat
- `REPO_ROOT`
- optional repo directory
- optional repo git branch / clean working tree
- optional indexed chunk count for a repo

## Test And Verification

Run static syntax checks:

```bash
npm run check
```

Run unit tests:

```bash
npm test
```

The current test suite covers:

- HMAC signature creation and verification
- bad-signature rejection
- empty-secret local development behavior
- repo-confined file reads
- path traversal rejection
- ignored directory rejection (`node_modules`)
- secret env file rejection (`.env`)
- symlink escape rejection
- signed HTTP `/api/read-file` success
- signed HTTP bad-signature rejection
- signed HTTP traversal and ignored-file rejection

The signed HTTP route tests start task-worker on a temporary local port. In
sandboxed environments that forbid local listening sockets, those tests skip
with a message. They should run normally on the WSL host.

## Daily Use

List available repos:

```text
/code-repos
```

Sync a git-backed repo mirror:

```text
/code-sync task-worker-rag
```

Read exact file content:

```text
/code-read hello-world index.js
```

Search indexed repo chunks:

```text
/code-search hello-world "Hello world" 5
```

After meaningful code changes in a mirrored repo:

```bash
cd ~/.hermes/repos/<repo_name>
git pull --ff-only

cd ~/Development/task-worker-rag
npm run index-codebase -- <repo_name>
npm run code-status -- <repo_name>
```

Repo lifecycle CLI:

```bash
npm run code-repos -- list
npm run code-repos -- add <git_url> [repo_name]
npm run code-repos -- show <repo_name>
npm run code-repos -- sync <repo_name>
npm run code-repos -- reindex <repo_name>
npm run code-repos -- cleanup <repo_name>
npm run sync-and-reindex -- <repo_name>
```

Use `/code-sync` or `npm run code-repos -- sync <repo_name>` to update the repo
mirror from git. Use `npm run code-repos -- reindex <repo_name>` afterward to
refresh ChromaDB.

Use `npm run sync-and-reindex -- <repo_name>` when you want both steps in one
operator command.

## Optional Reindex Timer

When installed with `--with-systemd`, the repo includes a template timer for
daily sync-and-reindex jobs:

```bash
systemctl --user enable --now code-memory-reindex@task-worker-rag.timer
systemctl --user list-timers 'code-memory-reindex@*'
```

Run one immediately:

```bash
systemctl --user start code-memory-reindex@task-worker-rag.service
```

Inspect logs:

```bash
journalctl --user -u code-memory-reindex@task-worker-rag.service -n 100 --no-pager
```

## Why Slash Commands Are The Local Default

The plugin still exposes LLM-callable tools (`code_search` and
`code_read_file`). Those are the clean model-tool path when a model/provider
reliably supports Hermes structured tool calling.

For the current local-only Ollama workflow, slash commands are the dependable
path because Hermes executes them directly through the documented plugin command
API.
