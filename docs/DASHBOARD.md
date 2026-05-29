# Dashboard

The dashboard is a decoupled Vite React app using Ant Design. It provides a
read-only operational view over task-worker-rag:

- service checks
- runtime configuration
- repo corpus table
- git state
- indexed chunk counts
- copyable Hermes/operator commands

## Development

Run task-worker:

```bash
npm start
```

Run the Vite dev server:

```bash
npm run dashboard:install
npm run dashboard:dev
```

Open:

```text
http://127.0.0.1:5173/dashboard/
```

The Vite dev server proxies `/api` to task-worker at
`http://127.0.0.1:9000`.

## Production / Local Install

Build the dashboard:

```bash
npm run dashboard:install
npm run dashboard:build
```

Task-worker serves the built app at:

```text
http://127.0.0.1:9000/dashboard/
```

Generated assets live under `dashboard/dist/` and are not committed.

## Dashboard APIs

The backend exposes read-only dashboard APIs:

```text
GET /api/dashboard/status
GET /api/dashboard/status?repo_name=<repo_name>
GET /api/dashboard/repos
```

These APIs are intended for local use with task-worker bound to `127.0.0.1`.
