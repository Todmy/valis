#!/usr/bin/env node

/**
 * mcp-prototype.js
 *
 * Bare-minimum MCP server with 3 tools (store, search, context) using SQLite + FTS5.
 * No extraction, no Haiku, no embeddings. Just proves the architecture works.
 *
 * Architecture:
 *   Agent <-> stdio JSON-RPC <-> this server <-> SQLite (single file)
 *
 * Tools:
 *   teamind_store   -- store a decision (raw text + optional metadata)
 *   teamind_search  -- search decisions via FTS5
 *   teamind_context -- get relevant decisions for a task description
 *
 * Run with MCP SDK:
 *   npm install @modelcontextprotocol/sdk better-sqlite3 zod
 *   node mcp-prototype.js
 *
 * Run without MCP SDK (raw stdio JSON-RPC):
 *   If @modelcontextprotocol/sdk is not installed, falls back to raw
 *   JSON-RPC over stdio. Same protocol, just no SDK dependency.
 *
 * Test with MCP Inspector:
 *   npx @modelcontextprotocol/inspector node mcp-prototype.js
 *
 * Add to Claude Code:
 *   claude mcp add teamind -- node /path/to/mcp-prototype.js
 */

var path = require('path');
var crypto = require('crypto');
var os = require('os');
var fs = require('fs');

// --- Config ---
var DB_PATH = process.env.TEAMIND_DB_PATH || path.join(os.homedir(), '.teamind', 'decisions.db');
var DB_DIR = path.dirname(DB_PATH);

// --- Ensure DB directory exists ---
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// --- Database Layer ---
var Database = require('better-sqlite3');
var db;

function initDB() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec([
    'CREATE TABLE IF NOT EXISTS decisions (',
    '  id TEXT PRIMARY KEY,',
    '  type TEXT NOT NULL DEFAULT \'decision\' CHECK(type IN (\'decision\', \'constraint\', \'pattern\', \'lesson\')),',
    '  summary TEXT NOT NULL,',
    '  detail TEXT NOT NULL DEFAULT \'\',',
    '  status TEXT NOT NULL DEFAULT \'active\' CHECK(status IN (\'active\', \'deprecated\', \'superseded\', \'proposed\')),',
    '  author TEXT,',
    '  source TEXT DEFAULT \'agent_session\',',
    '  confidence INTEGER DEFAULT 5 CHECK(confidence BETWEEN 1 AND 10),',
    '  affects TEXT DEFAULT \'[]\',',
    '  depends_on TEXT DEFAULT \'[]\',',
    '  contradicts TEXT DEFAULT \'[]\',',
    '  replaces TEXT DEFAULT \'[]\',',
    '  decided_by TEXT DEFAULT \'[]\',',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')',
  ].join('\n'));

  db.exec([
    'CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(',
    '  summary,',
    '  detail,',
    '  affects,',
    '  decided_by,',
    '  content=decisions,',
    '  content_rowid=rowid,',
    '  tokenize=\'porter unicode61\'',
    ')',
  ].join('\n'));

  // Sync triggers
  db.exec([
    'CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN',
    '  INSERT INTO decisions_fts(rowid, summary, detail, affects, decided_by)',
    '  VALUES (new.rowid, new.summary, new.detail, new.affects, new.decided_by);',
    'END',
  ].join('\n'));

  db.exec([
    'CREATE TRIGGER IF NOT EXISTS decisions_ad AFTER DELETE ON decisions BEGIN',
    '  INSERT INTO decisions_fts(decisions_fts, rowid, summary, detail, affects, decided_by)',
    '  VALUES (\'delete\', old.rowid, old.summary, old.detail, old.affects, old.decided_by);',
    'END',
  ].join('\n'));

  db.exec([
    'CREATE TRIGGER IF NOT EXISTS decisions_au AFTER UPDATE ON decisions BEGIN',
    '  INSERT INTO decisions_fts(decisions_fts, rowid, summary, detail, affects, decided_by)',
    '  VALUES (\'delete\', old.rowid, old.summary, old.detail, old.affects, old.decided_by);',
    '  INSERT INTO decisions_fts(rowid, summary, detail, affects, decided_by)',
    '  VALUES (new.rowid, new.summary, new.detail, new.affects, new.decided_by);',
    'END',
  ].join('\n'));

  db.exec('CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions(type)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status)');

  return db;
}

// --- Tool implementations ---

function toolStore(args) {
  var id = crypto.randomUUID();
  var text = args.text || '';
  var type = args.type || 'decision';
  var affects = args.affects || [];
  var context = args.context || '';

  // MVP: store raw text as both summary and detail.
  // Real implementation would call Haiku for extraction.
  // Heuristic: first sentence = summary, full text = detail.
  var firstSentenceEnd = text.indexOf('. ');
  var summary, detail;
  if (firstSentenceEnd > 0 && firstSentenceEnd < 200) {
    summary = text.substring(0, firstSentenceEnd + 1);
    detail = text;
  } else if (text.length > 200) {
    summary = text.substring(0, 197) + '...';
    detail = text;
  } else {
    summary = text;
    detail = context || text;
  }

  var stmt = db.prepare(
    'INSERT INTO decisions (id, type, summary, detail, status, source, affects) VALUES (?, ?, ?, ?, \'active\', \'agent_session\', ?)'
  );
  stmt.run(id, type, summary, detail, JSON.stringify(affects));

  var decision = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);

  return {
    id: id,
    summary: decision.summary,
    type: decision.type,
    status: decision.status,
    affects: JSON.parse(decision.affects),
    created_at: decision.created_at,
    message: 'Decision stored. In production, Haiku would extract structured fields.',
  };
}

function toolSearch(args) {
  var query = args.query || '';
  var type = args.type || null;
  var limit = args.limit || 5;

  if (!query.trim()) {
    // No query: return recent decisions, optionally filtered by type
    var sql = 'SELECT * FROM decisions WHERE status = \'active\'';
    var params = [];
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    var stmt = db.prepare(sql);
    var rows = stmt.all.apply(stmt, params);
    return {
      results: rows.map(formatDecision),
      total: rows.length,
      search_type: 'recent',
    };
  }

  // FTS5 search with BM25 ranking
  var sql2 = [
    'SELECT d.*, bm25(decisions_fts, 10.0, 5.0, 2.0, 1.0) AS rank',
    'FROM decisions_fts f',
    'JOIN decisions d ON d.rowid = f.rowid',
    'WHERE decisions_fts MATCH ?',
  ].join(' ');
  var params2 = [query];

  if (type) {
    sql2 += ' AND d.type = ?';
    params2.push(type);
  }

  sql2 += ' ORDER BY rank LIMIT ?';
  params2.push(limit);

  var rows2;
  try {
    var stmt2 = db.prepare(sql2);
    rows2 = stmt2.all.apply(stmt2, params2);
  } catch (err) {
    // FTS5 query syntax error -- try wrapping as phrase
    params2[0] = '"' + query.replace(/"/g, '') + '"';
    var stmt3 = db.prepare(sql2);
    rows2 = stmt3.all.apply(stmt3, params2);
  }

  return {
    results: rows2.map(function(r) {
      var d = formatDecision(r);
      d.score = r.rank;
      return d;
    }),
    total: rows2.length,
    search_type: 'fts5',
  };
}

function toolContext(args) {
  var taskDescription = args.task_description || '';
  var files = args.files || [];

  // Extract key terms from task description + file paths
  var searchTerms = [];
  var commonWords = [
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have',
    'will', 'been', 'about', 'into', 'need', 'should', 'would',
    'could', 'make', 'work', 'some', 'when', 'what', 'then',
  ];

  var words = taskDescription.toLowerCase().split(/\s+/);
  for (var i = 0; i < words.length; i++) {
    var w = words[i].replace(/[^a-z0-9]/g, '');
    if (w.length > 3 && commonWords.indexOf(w) === -1) {
      searchTerms.push(w);
    }
  }

  // Extract module names from file paths
  for (var fi = 0; fi < files.length; fi++) {
    var parts = files[fi].split('/');
    for (var pi = 0; pi < parts.length; pi++) {
      if (parts[pi].length > 2) {
        searchTerms.push(parts[pi].replace(/\.[^.]+$/, ''));
      }
    }
  }

  // Deduplicate
  var seen = {};
  var uniqueTerms = [];
  for (var ti = 0; ti < searchTerms.length; ti++) {
    if (!seen[searchTerms[ti]]) {
      seen[searchTerms[ti]] = true;
      uniqueTerms.push(searchTerms[ti]);
    }
  }
  uniqueTerms = uniqueTerms.slice(0, 10);

  if (uniqueTerms.length === 0) {
    return {
      decisions: [],
      summary: 'No relevant context found. Provide a task description or file paths.',
      search_terms: [],
    };
  }

  // Build OR query for FTS5
  var ftsQuery = uniqueTerms.join(' OR ');

  var allResults = [];
  try {
    var searchResult = toolSearch({ query: ftsQuery, limit: 10 });
    allResults = searchResult.results;
  } catch (err) {
    // Fallback: try each term individually
    for (var si = 0; si < Math.min(3, uniqueTerms.length); si++) {
      try {
        var partial = toolSearch({ query: uniqueTerms[si], limit: 3 });
        allResults = allResults.concat(partial.results);
      } catch (e) { /* skip bad terms */ }
    }
  }

  // Deduplicate by ID
  var seenIds = {};
  var deduped = [];
  for (var di = 0; di < allResults.length; di++) {
    if (!seenIds[allResults[di].id]) {
      seenIds[allResults[di].id] = true;
      deduped.push(allResults[di]);
    }
  }

  // Build summary
  var summaryParts = [];
  for (var ci = 0; ci < deduped.length; ci++) {
    var d = deduped[ci];
    summaryParts.push('- [' + d.type + '] ' + d.summary + ' (affects: ' + d.affects.join(', ') + ')');
  }

  return {
    decisions: deduped.slice(0, 7),
    summary: deduped.length > 0
      ? 'Found ' + deduped.length + ' relevant decisions:\n' + summaryParts.join('\n')
      : 'No relevant decisions found for this task.',
    search_terms: uniqueTerms,
    task: taskDescription,
  };
}

function formatDecision(row) {
  return {
    id: row.id,
    type: row.type,
    summary: row.summary,
    detail: row.detail,
    status: row.status,
    author: row.author,
    source: row.source,
    confidence: row.confidence,
    affects: JSON.parse(row.affects || '[]'),
    depends_on: JSON.parse(row.depends_on || '[]'),
    contradicts: JSON.parse(row.contradicts || '[]'),
    replaces: JSON.parse(row.replaces || '[]'),
    decided_by: JSON.parse(row.decided_by || '[]'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// =============================================
// MCP Server Layer
// =============================================

// Approach 1: Using @modelcontextprotocol/sdk (preferred)
function startWithSDK() {
  var McpServer = require('@modelcontextprotocol/sdk/server/mcp.js').McpServer;
  var StdioServerTransport = require('@modelcontextprotocol/sdk/server/stdio.js').StdioServerTransport;
  var z = require('zod');

  var server = new McpServer({
    name: 'teamind',
    version: '0.1.0',
  });

  // Tool: teamind_store
  server.tool(
    'teamind_store',
    'Store a decision, constraint, pattern, or lesson. Call this whenever you make or encounter an important technical decision.',
    {
      text: z.string().describe('The decision text. Can be raw text.'),
      type: z.enum(['decision', 'constraint', 'pattern', 'lesson']).optional().describe('Type of knowledge. Default: decision'),
      affects: z.array(z.string()).optional().describe('Module/service names this affects, e.g. ["payment-service"]'),
      context: z.string().optional().describe('Additional context'),
    },
    function(args) {
      var result = toolStore(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool: teamind_search
  server.tool(
    'teamind_search',
    'Search team decisions. Use before making architectural decisions to check what the team already decided.',
    {
      query: z.string().describe('Search query. Supports: "exact phrase", word1 OR word2, prefix*'),
      type: z.enum(['decision', 'constraint', 'pattern', 'lesson']).optional().describe('Filter by type'),
      limit: z.number().optional().describe('Max results (default 5)'),
    },
    function(args) {
      var result = toolSearch(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool: teamind_context
  server.tool(
    'teamind_context',
    'Get relevant team knowledge for your current task. Call at the start of a new task.',
    {
      task_description: z.string().describe('What you are working on'),
      files: z.array(z.string()).optional().describe('File paths you are editing'),
    },
    function(args) {
      var result = toolContext(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  var transport = new StdioServerTransport();
  server.connect(transport).then(function() {
    process.stderr.write('Teamind MCP server running (SDK mode, DB: ' + DB_PATH + ')\n');
  });
}

// Approach 2: Raw JSON-RPC 2.0 over stdio (no SDK dependency)
function startWithRawStdio() {
  process.stderr.write('Teamind MCP server running (raw stdio mode, DB: ' + DB_PATH + ')\n');

  var TOOLS = [
    {
      name: 'teamind_store',
      description: 'Store a decision, constraint, pattern, or lesson.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The decision text.' },
          type: { type: 'string', enum: ['decision', 'constraint', 'pattern', 'lesson'] },
          affects: { type: 'array', items: { type: 'string' }, description: 'Module names this affects.' },
          context: { type: 'string', description: 'Additional context.' },
        },
        required: ['text'],
      },
    },
    {
      name: 'teamind_search',
      description: 'Search team decisions, constraints, patterns, and lessons.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (FTS5 syntax).' },
          type: { type: 'string', enum: ['decision', 'constraint', 'pattern', 'lesson'] },
          limit: { type: 'number', description: 'Max results (default 5).' },
        },
        required: ['query'],
      },
    },
    {
      name: 'teamind_context',
      description: 'Get relevant team knowledge for your current task.',
      inputSchema: {
        type: 'object',
        properties: {
          task_description: { type: 'string', description: 'What you are working on.' },
          files: { type: 'array', items: { type: 'string' }, description: 'File paths you are editing.' },
        },
        required: ['task_description'],
      },
    },
  ];

  var SERVER_INFO = {
    name: 'teamind',
    version: '0.1.0',
  };

  var buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function(chunk) {
    buffer += chunk;

    var lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete last line

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      try {
        var msg = JSON.parse(line);
        handleMessage(msg);
      } catch (err) {
        sendError(null, -32700, 'Parse error: ' + err.message);
      }
    }
  });

  function handleMessage(msg) {
    // Notifications (no id) -- ignore
    if (msg.id === undefined || msg.id === null) return;

    var method = msg.method;
    var params = msg.params || {};

    if (method === 'initialize') {
      sendResult(msg.id, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    } else if (method === 'tools/list') {
      sendResult(msg.id, { tools: TOOLS });
    } else if (method === 'tools/call') {
      var toolName = params.name;
      var toolArgs = params.arguments || {};
      var result;

      try {
        if (toolName === 'teamind_store') {
          result = toolStore(toolArgs);
        } else if (toolName === 'teamind_search') {
          result = toolSearch(toolArgs);
        } else if (toolName === 'teamind_context') {
          result = toolContext(toolArgs);
        } else {
          sendError(msg.id, -32601, 'Unknown tool: ' + toolName);
          return;
        }

        sendResult(msg.id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        sendResult(msg.id, {
          content: [{ type: 'text', text: 'Error: ' + err.message }],
          isError: true,
        });
      }
    } else if (method === 'ping') {
      sendResult(msg.id, {});
    } else {
      sendError(msg.id, -32601, 'Method not found: ' + method);
    }
  }

  function sendResult(id, result) {
    var response = JSON.stringify({ jsonrpc: '2.0', id: id, result: result });
    process.stdout.write(response + '\n');
  }

  function sendError(id, code, message) {
    var response = JSON.stringify({
      jsonrpc: '2.0',
      id: id,
      error: { code: code, message: message },
    });
    process.stdout.write(response + '\n');
  }
}

// --- Entry point ---
initDB();

try {
  require.resolve('@modelcontextprotocol/sdk/server/mcp.js');
  require.resolve('zod');
  startWithSDK();
} catch (err) {
  process.stderr.write('MCP SDK not found, using raw stdio JSON-RPC mode.\n');
  process.stderr.write('For better experience: npm install @modelcontextprotocol/sdk zod\n');
  startWithRawStdio();
}
