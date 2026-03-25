#!/usr/bin/env node

/**
 * transcript-parser.js
 *
 * Finds the most recent JSONL transcript in ~/.claude/projects/,
 * parses it, extracts assistant messages with tool calls,
 * and outputs a summary of what the session did.
 *
 * Validates whether we can reliably extract decisions from
 * Claude Code transcripts as a primary capture mechanism.
 *
 * Usage:
 *   node transcript-parser.js                    # auto-find most recent
 *   node transcript-parser.js <path-to-jsonl>    # parse specific file
 *   node transcript-parser.js --all              # summarize all recent sessions
 *
 * JSONL line format (from Claude Code):
 * {
 *   "parentUuid": string | null,
 *   "isSidechain": boolean,
 *   "userType": "external" | "internal",
 *   "cwd": string,
 *   "sessionId": string,
 *   "version": string,
 *   "gitBranch": string,
 *   "type": "user" | "assistant" | "system" | "progress" | "result",
 *   "message": {
 *     "role": "user" | "assistant",
 *     "content": string | Array<ContentBlock>,
 *     "model"?: string,
 *     "id"?: string,
 *     "stop_reason"?: string
 *   },
 *   "uuid": string,
 *   "timestamp": string (ISO 8601)
 * }
 *
 * ContentBlock types:
 *   { "type": "text", "text": string }
 *   { "type": "thinking", "thinking": string }
 *   { "type": "tool_use", "id": string, "name": string, "input": object }
 *   { "type": "tool_result", "tool_use_id": string, "content": string }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Config ──────────────────────────────────────────────────────────────────

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const MAX_TEXT_PREVIEW = 200;

// ─── Find transcripts ────────────────────────────────────────────────────────

function findAllJsonlFiles(baseDir) {
  const results = [];
  if (!fs.existsSync(baseDir)) return results;

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      // Recurse into project directories
      const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const sub of subEntries) {
        const subPath = path.join(fullPath, sub.name);
        if (sub.isFile() && sub.name.endsWith('.jsonl')) {
          try {
            const stat = fs.statSync(subPath);
            results.push({ path: subPath, mtime: stat.mtime, size: stat.size });
          } catch (_) { /* skip unreadable */ }
        }
        // Also check sessions/ subdirectory
        if (sub.isDirectory() && sub.name === 'sessions') {
          const sessionEntries = fs.readdirSync(subPath, { withFileTypes: true });
          for (const sess of sessionEntries) {
            if (sess.isFile() && sess.name.endsWith('.jsonl')) {
              try {
                const sessPath = path.join(subPath, sess.name);
                const stat = fs.statSync(sessPath);
                results.push({ path: sessPath, mtime: stat.mtime, size: stat.size });
              } catch (_) { /* skip */ }
            }
          }
        }
      }
    }
  }

  return results.sort((a, b) => b.mtime - a.mtime);
}

function findMostRecentTranscript() {
  const files = findAllJsonlFiles(CLAUDE_PROJECTS_DIR);
  if (files.length === 0) {
    console.error('No .jsonl files found in', CLAUDE_PROJECTS_DIR);
    console.error('Make sure Claude Code has been used at least once.');
    process.exit(1);
  }
  return files[0];
}

// ─── Parse JSONL ─────────────────────────────────────────────────────────────

function parseJsonlFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  const parsed = [];
  let parseErrors = 0;

  for (let i = 0; i < lines.length; i++) {
    try {
      parsed.push(JSON.parse(lines[i]));
    } catch (err) {
      parseErrors++;
    }
  }

  return { entries: parsed, parseErrors, totalLines: lines.length };
}

// ─── Extract structured data ─────────────────────────────────────────────────

function extractToolCalls(contentBlocks) {
  if (!Array.isArray(contentBlocks)) return [];
  return contentBlocks
    .filter(block => block.type === 'tool_use')
    .map(block => ({
      name: block.name,
      id: block.id,
      input: block.input || {},
    }));
}

function extractTextContent(contentBlocks) {
  if (typeof contentBlocks === 'string') return contentBlocks;
  if (!Array.isArray(contentBlocks)) return '';
  return contentBlocks
    .filter(block => block.type === 'text')
    .map(block => block.text || '')
    .join('\n');
}

function extractThinking(contentBlocks) {
  if (!Array.isArray(contentBlocks)) return '';
  return contentBlocks
    .filter(block => block.type === 'thinking')
    .map(block => block.thinking || '')
    .join('\n');
}

function truncate(str, maxLen = MAX_TEXT_PREVIEW) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

// ─── Analyze session ─────────────────────────────────────────────────────────

function analyzeSession(entries) {
  const session = {
    sessionId: null,
    version: null,
    model: null,
    cwd: null,
    gitBranch: null,
    startTime: null,
    endTime: null,
    duration: null,

    // Counters
    totalEntries: entries.length,
    userMessages: 0,
    assistantMessages: 0,
    systemMessages: 0,
    progressEntries: 0,
    resultEntries: 0,
    otherEntries: 0,

    // Tool usage
    toolCalls: [],
    toolCallsByName: {},
    totalToolCalls: 0,

    // Content
    userPrompts: [],
    assistantTexts: [],
    filesEdited: new Set(),
    filesRead: new Set(),
    bashCommands: [],
    decisionsDetected: [],
  };

  for (const entry of entries) {
    // Extract metadata from first entry
    if (!session.sessionId && entry.sessionId) {
      session.sessionId = entry.sessionId;
      session.version = entry.version;
      session.cwd = entry.cwd;
      session.gitBranch = entry.gitBranch;
    }

    // Track timestamps
    if (entry.timestamp) {
      const ts = new Date(entry.timestamp);
      if (!session.startTime || ts < session.startTime) session.startTime = ts;
      if (!session.endTime || ts > session.endTime) session.endTime = ts;
    }

    // Categorize by type
    const type = entry.type;
    const message = entry.message;

    if (type === 'user' || (message && message.role === 'user')) {
      session.userMessages++;
      const text = message ? extractTextContent(message.content) : '';
      if (text) {
        session.userPrompts.push({
          text: truncate(text, 500),
          timestamp: entry.timestamp,
        });
      }
    } else if (type === 'assistant' || (message && message.role === 'assistant')) {
      session.assistantMessages++;

      // Extract model
      if (message && message.model && !session.model) {
        session.model = message.model;
      }

      // Extract tool calls
      if (message && message.content) {
        const tools = extractToolCalls(message.content);
        for (const tool of tools) {
          session.toolCalls.push({
            name: tool.name,
            input: summarizeToolInput(tool.name, tool.input),
            timestamp: entry.timestamp,
          });
          session.toolCallsByName[tool.name] = (session.toolCallsByName[tool.name] || 0) + 1;
          session.totalToolCalls++;

          // Track specific tool types
          if (tool.name === 'Edit' && tool.input && tool.input.file_path) {
            session.filesEdited.add(tool.input.file_path);
          }
          if (tool.name === 'Read' && tool.input && tool.input.file_path) {
            session.filesRead.add(tool.input.file_path);
          }
          if (tool.name === 'Bash' && tool.input && tool.input.command) {
            session.bashCommands.push(truncate(tool.input.command, 300));
          }
        }

        // Extract text for decision detection
        const text = extractTextContent(message.content);
        if (text) {
          session.assistantTexts.push(text);
        }
      }
    } else if (type === 'system') {
      session.systemMessages++;
    } else if (type === 'progress') {
      session.progressEntries++;
    } else if (type === 'result') {
      session.resultEntries++;
    } else {
      session.otherEntries++;
    }
  }

  // Calculate duration
  if (session.startTime && session.endTime) {
    session.duration = Math.round((session.endTime - session.startTime) / 1000);
  }

  // Detect decisions from assistant text
  session.decisionsDetected = detectDecisions(session.assistantTexts);

  // Convert sets to arrays for JSON output
  session.filesEdited = [...session.filesEdited];
  session.filesRead = [...session.filesRead];

  return session;
}

function summarizeToolInput(toolName, input) {
  if (!input) return {};
  switch (toolName) {
    case 'Bash':
      return { command: truncate(input.command, 200) };
    case 'Read':
      return { file: input.file_path };
    case 'Edit':
      return {
        file: input.file_path,
        old_preview: truncate(input.old_string, 80),
        new_preview: truncate(input.new_string, 80),
      };
    case 'Write':
      return { file: input.file_path, size: (input.content || '').length };
    case 'Glob':
      return { pattern: input.pattern, path: input.path };
    case 'Grep':
      return { pattern: input.pattern, path: input.path };
    case 'Skill':
      return { skill: input.skill || input.command };
    case 'WebFetch':
      return { url: input.url };
    case 'mcp__qdrant__qdrant-store':
    case 'mcp__qdrant__qdrant-find':
      return { collection: input.collection_name, query: truncate(input.query || input.information, 100) };
    default:
      // For MCP tools, show first 100 chars of stringified input
      return { summary: truncate(JSON.stringify(input), 150) };
  }
}

// ─── Decision detection heuristics ───────────────────────────────────────────

const DECISION_PATTERNS = [
  { pattern: /\b(decided|choosing|selected|opted for|going with|will use|switching to)\b/i, type: 'decision' },
  { pattern: /\b(because|reason|rationale|trade-?off|since|given that)\b/i, type: 'reasoning' },
  { pattern: /\b(constraint|limitation|cannot|should not|must not|blocked by)\b/i, type: 'constraint' },
  { pattern: /\b(pattern|convention|standard|approach|architecture|design)\b/i, type: 'pattern' },
  { pattern: /\b(bug|fix|issue|error|broken|regression|root cause)\b/i, type: 'lesson' },
  { pattern: /\b(refactor|rename|restructure|reorganize|migrate)\b/i, type: 'refactoring' },
];

function detectDecisions(texts) {
  const decisions = [];

  for (const text of texts) {
    // Split into sentences
    const sentences = text.split(/[.!?\n]+/).filter(s => s.trim().length > 20);

    for (const sentence of sentences) {
      for (const { pattern, type } of DECISION_PATTERNS) {
        if (pattern.test(sentence)) {
          decisions.push({
            type,
            text: truncate(sentence.trim(), 300),
          });
          break; // One match per sentence
        }
      }
    }
  }

  // Deduplicate similar decisions
  const seen = new Set();
  return decisions.filter(d => {
    const key = d.text.slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Output formatting ──────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds) return 'unknown';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function printSummary(session, fileInfo) {
  const sep = '─'.repeat(70);

  console.log(sep);
  console.log('SESSION TRANSCRIPT ANALYSIS');
  console.log(sep);
  console.log();

  // Metadata
  console.log('METADATA:');
  console.log(`  Session ID:   ${session.sessionId || 'unknown'}`);
  console.log(`  Model:        ${session.model || 'unknown'}`);
  console.log(`  Version:      ${session.version || 'unknown'}`);
  console.log(`  CWD:          ${session.cwd || 'unknown'}`);
  console.log(`  Git branch:   ${session.gitBranch || 'none'}`);
  console.log(`  Start:        ${session.startTime ? session.startTime.toISOString() : 'unknown'}`);
  console.log(`  End:          ${session.endTime ? session.endTime.toISOString() : 'unknown'}`);
  console.log(`  Duration:     ${formatDuration(session.duration)}`);
  console.log(`  File:         ${fileInfo.path}`);
  console.log(`  File size:    ${formatSize(fileInfo.size)}`);
  console.log();

  // Message counts
  console.log('MESSAGE COUNTS:');
  console.log(`  Total entries:     ${session.totalEntries}`);
  console.log(`  User messages:     ${session.userMessages}`);
  console.log(`  Assistant msgs:    ${session.assistantMessages}`);
  console.log(`  System messages:   ${session.systemMessages}`);
  console.log(`  Progress entries:  ${session.progressEntries}`);
  console.log(`  Result entries:    ${session.resultEntries}`);
  console.log(`  Other:             ${session.otherEntries}`);
  console.log();

  // Tool usage
  console.log('TOOL USAGE:');
  console.log(`  Total tool calls:  ${session.totalToolCalls}`);
  const sortedTools = Object.entries(session.toolCallsByName)
    .sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sortedTools) {
    console.log(`    ${name}: ${count}`);
  }
  console.log();

  // Files touched
  if (session.filesEdited.length > 0) {
    console.log('FILES EDITED:');
    for (const f of session.filesEdited) {
      console.log(`  - ${f}`);
    }
    console.log();
  }

  if (session.filesRead.length > 0) {
    console.log(`FILES READ: (${session.filesRead.length} total)`);
    for (const f of session.filesRead.slice(0, 20)) {
      console.log(`  - ${f}`);
    }
    if (session.filesRead.length > 20) {
      console.log(`  ... and ${session.filesRead.length - 20} more`);
    }
    console.log();
  }

  // Bash commands
  if (session.bashCommands.length > 0) {
    console.log(`BASH COMMANDS: (${session.bashCommands.length} total)`);
    for (const cmd of session.bashCommands.slice(0, 15)) {
      console.log(`  $ ${cmd}`);
    }
    if (session.bashCommands.length > 15) {
      console.log(`  ... and ${session.bashCommands.length - 15} more`);
    }
    console.log();
  }

  // User prompts (conversation flow)
  if (session.userPrompts.length > 0) {
    console.log('CONVERSATION FLOW (user prompts):');
    for (let i = 0; i < session.userPrompts.length; i++) {
      const p = session.userPrompts[i];
      const time = p.timestamp ? new Date(p.timestamp).toLocaleTimeString() : '';
      console.log(`  [${i + 1}] ${time} — ${truncate(p.text, 120)}`);
    }
    console.log();
  }

  // Detected decisions
  if (session.decisionsDetected.length > 0) {
    console.log(`DECISIONS/REASONING DETECTED: (${session.decisionsDetected.length})`);
    const byType = {};
    for (const d of session.decisionsDetected) {
      if (!byType[d.type]) byType[d.type] = [];
      byType[d.type].push(d);
    }
    for (const [type, items] of Object.entries(byType)) {
      console.log(`  [${type.toUpperCase()}] (${items.length}):`);
      for (const item of items.slice(0, 5)) {
        console.log(`    - ${item.text}`);
      }
      if (items.length > 5) {
        console.log(`    ... and ${items.length - 5} more`);
      }
    }
    console.log();
  }

  // Extraction quality assessment
  console.log(sep);
  console.log('EXTRACTION QUALITY ASSESSMENT:');
  console.log(sep);

  const hasToolCalls = session.totalToolCalls > 0;
  const hasUserPrompts = session.userPrompts.length > 0;
  const hasDecisions = session.decisionsDetected.length > 0;
  const hasTimestamps = session.startTime !== null;
  const hasModel = session.model !== null;
  const hasFiles = session.filesEdited.length > 0 || session.filesRead.length > 0;

  const checks = [
    { label: 'Tool calls captured', ok: hasToolCalls },
    { label: 'User prompts captured', ok: hasUserPrompts },
    { label: 'Decisions detectable', ok: hasDecisions },
    { label: 'Timestamps present', ok: hasTimestamps },
    { label: 'Model identified', ok: hasModel },
    { label: 'Files trackable', ok: hasFiles },
  ];

  let passed = 0;
  for (const check of checks) {
    const status = check.ok ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${check.label}`);
    if (check.ok) passed++;
  }

  console.log();
  console.log(`  Score: ${passed}/${checks.length}`);
  console.log();

  // Verdict
  console.log('VERDICT FOR VALIS ARCHITECTURE:');
  if (passed >= 5) {
    console.log('  JSONL transcripts contain rich, parseable data.');
    console.log('  Tool calls, file operations, and reasoning are all extractable.');
    console.log('  This VALIDATES transcript parsing as a viable capture mechanism.');
  } else if (passed >= 3) {
    console.log('  Partial data available. Transcript captures basic interactions');
    console.log('  but decision extraction requires more sophisticated NLP.');
  } else {
    console.log('  Insufficient data in transcript for reliable extraction.');
    console.log('  MCP explicit capture remains necessary as primary mechanism.');
  }
  console.log();
  console.log('  CAVEAT: This only works for Claude Code.');
  console.log('  Cursor: SQLite in ~/Library/Application Support/Cursor/User/workspaceStorage/*/state.vscdb');
  console.log('  Codex:  JSONL in ~/.codex/sessions/ (similar format, different fields)');
  console.log();
}

// ─── JSON output mode ────────────────────────────────────────────────────────

function printJson(session, fileInfo) {
  const output = {
    meta: {
      file: fileInfo.path,
      fileSize: fileInfo.size,
      parsedAt: new Date().toISOString(),
      parser: 'transcript-parser.js v1.0',
    },
    session: {
      id: session.sessionId,
      model: session.model,
      version: session.version,
      cwd: session.cwd,
      gitBranch: session.gitBranch,
      startTime: session.startTime,
      endTime: session.endTime,
      durationSeconds: session.duration,
    },
    counts: {
      total: session.totalEntries,
      user: session.userMessages,
      assistant: session.assistantMessages,
      system: session.systemMessages,
      progress: session.progressEntries,
      result: session.resultEntries,
      toolCalls: session.totalToolCalls,
    },
    toolUsage: session.toolCallsByName,
    filesEdited: session.filesEdited,
    filesRead: session.filesRead,
    bashCommands: session.bashCommands,
    userPrompts: session.userPrompts,
    decisionsDetected: session.decisionsDetected,
    toolCallTimeline: session.toolCalls,
  };

  console.log(JSON.stringify(output, null, 2));
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const allMode = args.includes('--all');
  const filteredArgs = args.filter(a => !a.startsWith('--'));

  let targetFile;

  if (filteredArgs.length > 0) {
    // Explicit file path
    targetFile = { path: path.resolve(filteredArgs[0]) };
    try {
      const stat = fs.statSync(targetFile.path);
      targetFile.size = stat.size;
      targetFile.mtime = stat.mtime;
    } catch (err) {
      console.error(`Cannot access ${targetFile.path}: ${err.message}`);
      process.exit(1);
    }
  } else if (allMode) {
    // Show summary of all recent sessions
    const files = findAllJsonlFiles(CLAUDE_PROJECTS_DIR);
    console.log(`Found ${files.length} transcript files\n`);
    for (const file of files.slice(0, 20)) {
      const { entries } = parseJsonlFile(file.path);
      const session = analyzeSession(entries);
      const projectDir = path.basename(path.dirname(file.path));
      console.log(`  ${file.mtime.toISOString().slice(0, 16)} | ${formatSize(file.size).padStart(8)} | ${session.userMessages} prompts | ${session.totalToolCalls} tools | ${projectDir}`);
    }
    return;
  } else {
    // Auto-find most recent
    targetFile = findMostRecentTranscript();
    console.log(`Auto-selected most recent transcript: ${targetFile.path}\n`);
  }

  const { entries, parseErrors, totalLines } = parseJsonlFile(targetFile.path);

  if (parseErrors > 0) {
    console.error(`Warning: ${parseErrors}/${totalLines} lines failed to parse`);
  }

  if (entries.length === 0) {
    console.error('No valid entries found in transcript');
    process.exit(1);
  }

  const session = analyzeSession(entries);

  if (jsonMode) {
    printJson(session, targetFile);
  } else {
    printSummary(session, targetFile);
  }
}

main();
