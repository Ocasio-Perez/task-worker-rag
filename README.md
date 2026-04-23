# Description
A dedicated local HTTP worker for OpenClaw so Hermes can delegate tasks over JSON instead of trying to route work through Telegram.
# Install
cd ~/OpenClaw-Task-Worker
echo 'AGENT_NAME="your-agent-name"' >> .env
npm install
npm run dev
# Health check
curl http://127.0.0.1:9000/health
# Task test
curl -X POST http://127.0.0.1:9000/task \
  -H "Content-Type: application/json" \
  -d '{
    "task_id":"test-001",
    "from":"hermes",
    "agent":"your-agent-name",
    "goal":"Check whether Ollama responds at /v1/models",
    "context":{"base_url":"http://127.0.0.1:11434/v1"},
    "constraints":{"tools_allowed":["http"],"timeout_sec":30},
    "expected_output":{"format":"json"}
  }'