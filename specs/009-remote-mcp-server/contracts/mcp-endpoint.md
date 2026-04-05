# Contract: MCP HTTP Endpoint

## Endpoint

```
POST https://valis.krukit.co/api/mcp
```

## Authentication

```
Authorization: Bearer tmm_<32-hex-chars>
```

Or org-level key:
```
Authorization: Bearer tm_<32-hex-chars>
```

## Request Format

Standard JSON-RPC 2.0 as per MCP Streamable HTTP spec.

### Initialize

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "claude-ai",
      "version": "1.0.0"
    }
  }
}
```

### List Tools

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

### Call Tool

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "valis_search",
    "arguments": {
      "query": "authentication decisions",
      "limit": 5
    }
  }
}
```

## Response Format

### Success (200)

JSON-RPC 2.0 response with MCP tool result:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"results\": [...]}"
      }
    ]
  }
}
```

### Auth Error (401)

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Unauthorized"
  },
  "id": null
}
```

### Bad Request (400)

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32700,
    "message": "Parse error"
  },
  "id": null
}
```

## CORS

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, Mcp-Session-Id
```

## Available Tools

| Tool | Description |
|---|---|
| valis_store | Store a decision, constraint, pattern, or lesson |
| valis_search | Search team decision history |
| valis_context | Load relevant decisions for a task |
| valis_lifecycle | Manage decision lifecycle (deprecate, promote, pin, history) |

Tool schemas are identical to CLI MCP server — documented in `packages/cli/src/mcp/server.ts`.
