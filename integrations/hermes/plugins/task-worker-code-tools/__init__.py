"""Hermes plugin exposing task-worker-rag code tools."""

import hashlib
import hmac
import json
import os
import pathlib
import shlex
import urllib.error
import urllib.request
import uuid


DEFAULT_SEARCH_URL = "http://127.0.0.1:9000/api/search-codebase"
DEFAULT_READ_FILE_URL = "http://127.0.0.1:9000/api/read-file"


def register(ctx):
    ctx.register_tool(
        name="code_search",
        toolset="task_worker_code_tools",
        schema={
            "name": "code_search",
            "description": "Search indexed repository code memory through task-worker-rag.",
            "parameters": {
                "type": "object",
                "properties": {
                    "repo_name": {
                        "type": "string",
                        "description": "Repository name under REPO_ROOT, for example hello-world.",
                    },
                    "query": {
                        "type": "string",
                        "description": "Natural-language or code search query.",
                    },
                    "n_results": {
                        "type": "integer",
                        "description": "Maximum number of matching chunks to return.",
                        "default": 5,
                    },
                    "include_content": {
                        "type": "boolean",
                        "description": "Include full chunk content in search results.",
                        "default": False,
                    },
                },
                "required": ["repo_name", "query"],
            },
        },
        handler=handle_code_search,
        description="Search indexed repository code memory through task-worker-rag.",
    )

    ctx.register_tool(
        name="code_read_file",
        toolset="task_worker_code_tools",
        schema={
            "name": "code_read_file",
            "description": "Read a repo-confined source file through task-worker-rag.",
            "parameters": {
                "type": "object",
                "properties": {
                    "repo_name": {
                        "type": "string",
                        "description": "Repository name under REPO_ROOT, for example hello-world.",
                    },
                    "relative_path": {
                        "type": "string",
                        "description": "Repo-relative file path, for example index.js.",
                    },
                    "max_bytes": {
                        "type": "integer",
                        "description": "Maximum bytes to read.",
                        "default": 50000,
                    },
                },
                "required": ["repo_name", "relative_path"],
            },
        },
        handler=handle_code_read_file,
        description="Read a repo-confined source file through task-worker-rag.",
    )

    ctx.register_command(
        "code-read",
        handler=_handle_code_read_command,
        description="Read a file from an indexed local repo.",
    )

    ctx.register_command(
        "code-search",
        handler=_handle_code_search_command,
        description="Search an indexed local repo.",
    )

    ctx.register_command(
        "code-status",
        handler=_handle_code_status_command,
        description="Show task-worker code-memory integration status.",
    )


def handle_code_search(params=None, **kwargs):
    _debug("code_search raw params=", params, " kwargs=", kwargs)
    params = _params(params, kwargs)
    _debug("code_search normalized params=", params)

    body = {
        "repo_name": _repo_name(params),
        "query": str(params.get("query") or "").strip(),
        "n_results": _positive_int(params.get("n_results") or params.get("max_results"), 5),
    }

    if params.get("include_content"):
        body["include_content"] = True

    return _post_signed_json(
        os.environ.get("CODE_SEARCH_URL", DEFAULT_SEARCH_URL),
        body,
    )


def handle_code_read_file(params=None, **kwargs):
    _debug("code_read_file raw params=", params, " kwargs=", kwargs)
    params = _params(params, kwargs)
    _debug("code_read_file normalized params=", params)

    repo_name = _repo_name(params)
    body = {
        "repo_name": repo_name,
        "relative_path": _relative_path(params, repo_name),
        "max_bytes": _positive_int(params.get("max_bytes"), 50000),
    }

    result = _post_signed_json(
        os.environ.get("CODE_READ_FILE_URL", DEFAULT_READ_FILE_URL),
        body,
    )
    return _read_file_content_or_result(result)


def _handle_code_read_command(raw_args):
    try:
        args = shlex.split(raw_args or "")
    except ValueError as error:
        return f"Usage: /code-read <repo_name> <relative_path> [max_bytes]\nError: {error}"

    if len(args) < 2:
        return "Usage: /code-read <repo_name> <relative_path> [max_bytes]"

    result = handle_code_read_file(
        {
            "repo_name": args[0],
            "relative_path": args[1],
            "max_bytes": args[2] if len(args) > 2 else 50000,
        }
    )

    return _read_file_command_output(result)


def _handle_code_search_command(raw_args):
    try:
        args = shlex.split(raw_args or "")
    except ValueError as error:
        return f"Usage: /code-search <repo_name> <query> [n_results]\nError: {error}"

    if len(args) < 2:
        return "Usage: /code-search <repo_name> <query> [n_results]"

    result = handle_code_search(
        {
            "repo_name": args[0],
            "query": args[1],
            "n_results": args[2] if len(args) > 2 else 5,
        }
    )

    return _format_search_command_output(result)


def _handle_code_status_command(raw_args):
    del raw_args
    search_url = os.environ.get("CODE_SEARCH_URL", DEFAULT_SEARCH_URL)
    read_url = os.environ.get("CODE_READ_FILE_URL", DEFAULT_READ_FILE_URL)
    health_url = search_url.split("/api/", 1)[0].rstrip("/") + "/health"

    try:
        with urllib.request.urlopen(health_url, timeout=5) as response:
            body = response.read().decode("utf-8")
    except Exception as error:
        return f"task-worker: FAIL {error}\nsearch_url: {search_url}\nread_file_url: {read_url}"

    secret_state = "set" if os.environ.get("CODE_SEARCH_HMAC_SECRET") else "missing"
    return "\n".join(
        [
            "task-worker: OK",
            f"health: {body}",
            f"search_url: {search_url}",
            f"read_file_url: {read_url}",
            f"code_search_hmac_secret: {secret_state}",
        ]
    )


def _params(params, kwargs):
    merged = _coerce_mapping(params)
    merged.update(_coerce_mapping(kwargs))

    for key in ("arguments", "args", "input", "parameters", "params"):
        nested = _coerce_mapping(merged.get(key))
        if nested:
            merged.update(nested)

    return merged


def _coerce_mapping(value):
    if isinstance(value, dict):
        return dict(value)

    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}

        if isinstance(parsed, dict):
            return dict(parsed)

    return {}


def _read_file_content_or_result(result):
    try:
        parsed = json.loads(result)
    except (TypeError, json.JSONDecodeError):
        return result

    if parsed.get("ok") is True and isinstance(parsed.get("content"), str):
        return json.dumps(
            {
                "ok": True,
                "content": parsed["content"],
            },
            separators=(",", ":"),
        )

    return result


def _read_file_command_output(result):
    try:
        parsed = json.loads(result)
    except (TypeError, json.JSONDecodeError):
        return result

    if parsed.get("ok") is True and isinstance(parsed.get("content"), str):
        return parsed["content"]

    return result


def _format_search_command_output(result):
    try:
        parsed = json.loads(result)
    except (TypeError, json.JSONDecodeError):
        return result

    if parsed.get("ok") is False or parsed.get("success") is False:
        return result

    results = parsed.get("results") or []
    lines = [
        parsed.get("summary")
        or f"Found {len(results)} result(s) for {parsed.get('query') or 'query'}",
    ]

    for index, item in enumerate(results, start=1):
        file_name = item.get("file") or item.get("fullPath") or "<unknown>"
        chunk = item.get("chunk")
        distance = item.get("distance")
        preview = " ".join(str(item.get("preview") or "").split())
        if len(preview) > 180:
            preview = f"{preview[:177]}..."

        meta = f"#{index} {file_name}"
        if chunk is not None:
            meta += f" chunk={chunk}"
        if isinstance(distance, (int, float)):
            meta += f" distance={distance:.4f}"

        lines.append(meta)
        if preview:
            lines.append(f"  {preview}")

    return "\n".join(lines)


def _post_signed_json(url, body):
    _debug("POST ", url, " body=", body)
    raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
    secret = os.environ.get("CODE_SEARCH_HMAC_SECRET", "")

    headers = {
        "Content-Type": "application/json",
        "X-Request-Id": str(uuid.uuid4()),
    }

    if secret:
        digest = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
        headers["X-Code-Search-Signature"] = f"sha256={digest}"

    request = urllib.request.Request(url, data=raw, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        return json.dumps(
            {
                "success": False,
                "ok": False,
                "error": "task_worker_http_error",
                "status": error.code,
                "detail": detail,
            }
        )
    except Exception as error:
        return json.dumps(
            {
                "success": False,
                "ok": False,
                "error": "task_worker_request_failed",
                "detail": str(error),
            }
        )


def _debug(*parts):
    if os.environ.get("TASK_WORKER_CODE_TOOLS_DEBUG", "").lower() not in {
        "1",
        "true",
        "yes",
        "on",
    }:
        return

    print("[task-worker-code-tools]", *parts, flush=True)


def _positive_int(value, default):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default

    return parsed if parsed > 0 else default


def _repo_name(params):
    explicit = str(params.get("repo_name") or params.get("repo") or "").strip()
    if explicit:
        return explicit

    path = str(params.get("repo_path") or params.get("path") or "").strip()
    if not path:
        return ""

    return pathlib.PurePosixPath(path).name


def _relative_path(params, repo_name):
    explicit = str(
        params.get("relative_path")
        or params.get("file")
        or params.get("filename")
        or ""
    ).strip()
    if explicit:
        return explicit

    path = str(params.get("path") or "").strip()
    if not path:
        return ""

    pure_path = pathlib.PurePosixPath(path)
    parts = pure_path.parts
    if repo_name in parts:
        repo_index = parts.index(repo_name)
        relative_parts = parts[repo_index + 1 :]
        if relative_parts:
            return str(pathlib.PurePosixPath(*relative_parts))

    return pure_path.name
