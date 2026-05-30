# Business Strategy

## Product Direction

This product is a closed-source, proprietary, local-first developer tool.

Core promise:

```text
Private local code memory for AI agents, without sending source code to the cloud.
```

Primary users:

- local AI builders
- WSL/Linux developers
- small engineering teams
- privacy-conscious companies
- teams experimenting with local agents, Ollama, and Hermes-style workflows

Primary interface:

```text
Dashboard + Hermes CLI slash commands
```

Not required for the core product:

- Telegram
- cloud models
- hosted SaaS
- open-source release

Telegram can remain an optional notification/control channel later, but it is
not part of the golden path.

## Business Model

Start with a productized service rather than a public software license.

Offer:

```text
Done-for-you private AI code-memory setup.
```

Keep the core repo private. Sell the implementation outcome first.

Customer deliverables:

- local code-memory stack
- repo indexing and semantic search
- private dashboard
- Hermes slash-command workflow
- sync/reindex automation
- basic onboarding/training
- support window

Suggested pricing:

```text
Starter: $750-1,500
Pro: $2,500-5,000
Team: $7,500+
Support: $300-2,000/month
```

Later evolution:

```text
self-hosted proprietary license + support + enterprise features
```

## Supported Golden Path

Start with:

```text
WSL2 Ubuntu + Linux Ubuntu/Debian
```

Secondary later:

```text
macOS assisted install
```

Defer:

```text
native Windows production install
```

Recommended customer baseline:

```text
Minimum:
8 CPU cores
24 GB RAM
100 GB SSD
Node 20+
Git
Ollama
ChromaDB

Recommended:
12+ CPU cores
32-64 GB RAM
250 GB+ NVMe
GPU helpful for larger workloads
```

Default local models:

```text
Embedding: nomic-embed-text
Reasoning: qwen3-coder:30b on recommended hardware
Fallback: qwen2.5-coder:14b for smaller machines
```

## Current Product State

Built and working:

- task-worker backend
- signed search/read APIs
- ChromaDB code memory
- repo confinement and read-file safety checks
- Hermes plugin
- Hermes slash commands
- repo lifecycle commands
- install script
- systemd templates
- sync/reindex automation
- test suite
- Vite + Ant Design dashboard
- docs

Primary commands:

```text
/code-help
/code-status
/code-repos
/code-sync <repo_name>
/code-search <repo_name> "query" 5
/code-read <repo_name> path/to/file
```

Dashboard:

```text
http://127.0.0.1:9000/dashboard/
```

## Next Priorities

Focus on commercialization readiness before adding more product features.

1. Rename and brand the product.
   - choose product name
   - choose tagline
   - define private repo/package identity

2. Create customer install playbook.
   - WSL/Linux golden path
   - preflight checklist
   - install steps
   - validation steps
   - handoff steps
   - troubleshooting

3. Build `preflight.sh`.
   - OS
   - CPU/RAM/disk
   - Node/npm
   - Git
   - Ollama
   - ChromaDB
   - ports
   - Hermes config
   - repo root
   - dashboard build

4. Package the first offer.

   ```text
   Private AI Code Memory Setup
   ```

   Include:

   - deliverables
   - price
   - timeline
   - customer requirements

5. Do 1-3 pilot installs.
   - install manually for trusted users/teams
   - capture every rough edge
   - turn repeated steps into automation

## Immediate Engineering Task

Create the WSL/Linux install playbook and preflight script.

This supports monetization directly and reduces manual installation burden.
