#!/usr/bin/env node

/**
 * sqlite-prototype.js
 *
 * Validates: Is SQLite + FTS5 (+ optional sqlite-vec) good enough for Teamind MVP?
 *
 * Tests:
 * 1. Create SQLite DB with decisions table + FTS5 index
 * 2. Insert 10 sample decisions with realistic data
 * 3. Test keyword search via FTS5 (BM25 ranking)
 * 4. Test filtered search (by type, status, affects)
 * 5. Measure query latency
 * 6. Optionally test sqlite-vec for vector search (if available)
 *
 * Run: node sqlite-prototype.js
 * Requires: npm install better-sqlite3
 * Optional: npm install sqlite-vec (for vector search test)
 *
 * Conclusion at bottom: FTS5-only vs Qdrant for <500 decisions.
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// --- Config ---
const DB_PATH = path.join(__dirname, 'teamind-test.db');

// --- Sample decisions (realistic engineering team data) ---
const SAMPLE_DECISIONS = [
  {
    type: 'decision',
    summary: 'Use PostgreSQL for payment service database',
    detail: 'After evaluating PostgreSQL, MySQL, and DynamoDB, we chose PostgreSQL for the payment service. Reasons: ACID compliance critical for financial transactions, strong JSON support for flexible schemas, mature ecosystem. DynamoDB was rejected due to eventual consistency concerns for payment data.',
    status: 'active',
    author: 'oleg',
    source: 'agent_session',
    confidence: 9,
    affects: JSON.stringify(['payment-service', 'order-api']),
    depends_on: JSON.stringify([]),
    contradicts: JSON.stringify([]),
    replaces: JSON.stringify([]),
    decided_by: JSON.stringify(['Oleg', 'Maria']),
  },
  {
    type: 'decision',
    summary: 'Use Redis for session caching instead of Memcached',
    detail: 'Redis chosen over Memcached for session management. Key factors: Redis supports data structures (sorted sets for session expiry), persistence option for crash recovery, pub/sub for real-time session invalidation across instances. Memcached is simpler but lacks these features.',
    status: 'active',
    author: 'maria',
    source: 'agent_session',
    confidence: 8,
    affects: JSON.stringify(['auth-service', 'api-gateway']),
    depends_on: JSON.stringify([]),
    contradicts: JSON.stringify([]),
    replaces: JSON.stringify([]),
    decided_by: JSON.stringify(['Maria']),
  },
  {
    type: 'constraint',
    summary: 'All API endpoints must return responses within 200ms p99',
    detail: 'Performance constraint: every public API endpoint must respond within 200ms at p99 latency. This drives architecture choices — no synchronous calls to external services in the hot path. Background processing via message queues for anything that might be slow.',
    status: 'active',
    author: 'dmytro',
    source: 'manual',
    confidence: 10,
    affects: JSON.stringify(['api-gateway', 'payment-service', 'order-api', 'auth-service']),
    depends_on: JSON.stringify([]),
    contradicts: JSON.stringify([]),
    replaces: JSON.stringify([]),
    decided_by: JSON.stringify(['Dmytro', 'CTO']),
  },
  {
    type: 'pattern',
    summary: 'Use event sourcing for order state management',
    detail: 'Orders follow event sourcing pattern: OrderCreated, PaymentReceived, OrderShipped, OrderDelivered. Each state transition is an immutable event. Current state is computed by replaying events. Benefits: full audit trail, easy debugging, can rebuild read models.',
    status: 'active',
    author: 'oleg',
    source: 'pr_review',
    confidence: 8,
    affects: JSON.stringify(['order-api', 'payment-service']),
    depends_on: JSON.stringify([]),
    contradicts: JSON.stringify([]),
    replaces: JSON.stringify([]),
    decided_by: JSON.stringify(['Oleg', 'Dmytro']),
  },
  {
    type: 'lesson',
    summary: 'MongoDB connection pooling caused payment failures under load',
    detail: 'During load testing, MongoDB default connection pool (5 connections) was insufficient. Under 500 concurrent requests, connections exhausted, causing payment processing failures. Fix: increased pool to 50, added connection timeout of 5s, added circuit breaker. Lesson: always load test with realistic concurrency before production.',
    status: 'active',
    author: 'maria',
    source: 'agent_session',
    confidence: 9,
    affects: JSON.stringify(['payment-service']),
    depends_on: JSON.stringify([]),
    contradicts: JSON.stringify([]),
    replaces: JSON.stringify([]),
    decided_by: JSON.stringify(['Maria']),
  },
  {
    type: 'decision',
    summary: 'Migrate authentication from JWT to session tokens',
    detail: 'Switching from stateless JWT to server-side session tokens stored in Redis. Reasons: JWT revocation is painful (need blocklist), token size grows with claims, session tokens allow instant invalidation. Trade-off: adds Redis dependency and slight latency for session lookup.',
    status: 'active',
    author: 'dmytro',
    source: 'meeting',
    confidence: 7,
    affects: JSON.stringify(['auth-service', 'api-gateway', 'frontend']),
    depends_on: JSON.stringify([]),
    contradicts: JSON.stringify([]),
    replaces: JSON.stringify([]),
    decided_by: JSON.stringify(['Dmytro', 'Maria', 'Oleg']),
  },
  {
    type: 'decision',
    summary: 'Use DynamoDB for analytics event storage',
    detail: 'Analytics events (page views, clicks, conversions) stored in DynamoDB. High write throughput needed (10K events/sec peak), eventual consistency is fine for analytics, cost-effective at scale with on-demand pricing. PostgreSQL was considered but rejected due to write amplification at this volume.',
    status: 'active',
    author: 'oleg',
    source: 'agent_session',
    confidence: 8,
    affects: JSON.stringify(['analytics-service', 'data-pipeline']),
    depends_on: JSON.stringify([]),
    contradicts: JSON.stringify([]),
    replaces: JSON.stringify([]),
    decided_by: JSON.stringify(['Oleg']),
  },
  {
    type: 'constraint',
    summary: 'No direct database access from frontend — all through API gateway',
    detail: 'Security constraint: frontend applications must never connect directly to any database. All data access goes through the API gateway, which handles authentication, rate limiting, and request validation. This prevents SQL injection and data leakage risks.',
    status: 'active',
    author: 'dmytro',
    source: 'manual',
    confidence: 10,
    affects: JSON.stringify(['frontend', 'api-gateway']),
    depends_on: JSON.stringify([]),
    contradicts: JSON.stringify([]),
    replaces: JSON.stringify([]),
    decided_by: JSON.stringify(['Dmytro', 'CTO']),
  },
  {
    type: 'pattern',
    summary: 'Circuit breaker pattern for all external service calls',
    detail: 'Every call to an external service (payment gateway, email provider, SMS) must use circuit breaker pattern. Configuration: 5 failures to open, 30s timeout before half-open, 3 successes to close. Implementation: opossum library for Node.js services. Prevents cascade failures.',
    status: 'active',
    author: 'maria',
    source: 'pr_review',
    confidence: 9,
    affects: JSON.stringify(['payment-service', 'notification-service', 'order-api']),
    depends_on: JSON.stringify([]),
    contradicts: JSON.stringify([]),
    replaces: JSON.stringify([]),
    decided_by: JSON.stringify(['Maria', 'Oleg']),
  },
  {
    type: 'decision',
    summary: 'Use MySQL instead of PostgreSQL for the user profile service',
    detail: 'User profile service will use MySQL 8.0. Team has more MySQL experience for this type of CRUD-heavy workload. Read replicas for scaling reads. Simple schema that does not need PostgreSQL advanced features. Note: this is a different choice than payment service (which uses PostgreSQL).',
    status: 'active',
    author: 'oleg',
    source: 'agent_session',
    confidence: 6,
    affects: JSON.stringify(['user-service']),
    depends_on: JSON.stringify([]),
    contradicts: JSON.stringify([]),
    replaces: JSON.stringify([]),
    decided_by: JSON.stringify(['Oleg']),
  },
];

// --- Database setup ---
function createDatabase() {
  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Create main decisions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('decision', 'constraint', 'pattern', 'lesson')),
      summary TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deprecated', 'superseded', 'proposed')),
      author TEXT,
      source TEXT,
      confidence INTEGER CHECK(confidence BETWEEN 1 AND 10),
      affects TEXT DEFAULT '[]',
      depends_on TEXT DEFAULT '[]',
      contradicts TEXT DEFAULT '[]',
      replaces TEXT DEFAULT '[]',
      decided_by TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Create FTS5 virtual table for full-text search
  // tokenize='porter unicode61' gives stemming (e.g., "running" matches "run")
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
      summary,
      detail,
      affects,
      decided_by,
      content=decisions,
      content_rowid=rowid,
      tokenize='porter unicode61'
    )
  `);

  // Triggers to keep FTS5 index in sync with decisions table
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
      INSERT INTO decisions_fts(rowid, summary, detail, affects, decided_by)
      VALUES (new.rowid, new.summary, new.detail, new.affects, new.decided_by);
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS decisions_ad AFTER DELETE ON decisions BEGIN
      INSERT INTO decisions_fts(decisions_fts, rowid, summary, detail, affects, decided_by)
      VALUES ('delete', old.rowid, old.summary, old.detail, old.affects, old.decided_by);
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS decisions_au AFTER UPDATE ON decisions BEGIN
      INSERT INTO decisions_fts(decisions_fts, rowid, summary, detail, affects, decided_by)
      VALUES ('delete', old.rowid, old.summary, old.detail, old.affects, old.decided_by);
      INSERT INTO decisions_fts(rowid, summary, detail, affects, decided_by)
      VALUES (new.rowid, new.summary, new.detail, new.affects, new.decided_by);
    END
  `);

  // Index for common filters
  db.exec('CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions(type)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_decisions_author ON decisions(author)');

  return db;
}

// --- Insert sample data ---
function insertSampleData(db) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO decisions (id, type, summary, detail, status, author, source, confidence, affects, depends_on, contradicts, replaces, decided_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((decisions) => {
    for (const d of decisions) {
      const id = crypto.randomUUID();
      insert.run(id, d.type, d.summary, d.detail, d.status, d.author, d.source, d.confidence, d.affects, d.depends_on, d.contradicts, d.replaces, d.decided_by);
    }
  });

  insertMany(SAMPLE_DECISIONS);
}

// --- Search functions ---

/**
 * FTS5 keyword search with BM25 ranking.
 * This is the core search for MVP without vector embeddings.
 */
function searchFTS(db, query, limit) {
  limit = limit || 5;
  const stmt = db.prepare(`
    SELECT
      d.*,
      bm25(decisions_fts, 10.0, 5.0, 2.0, 1.0) AS rank
    FROM decisions_fts f
    JOIN decisions d ON d.rowid = f.rowid
    WHERE decisions_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);
  // BM25 weights: summary=10, detail=5, affects=2, decided_by=1
  // Lower BM25 score = better match (negative values)
  return stmt.all(query, limit);
}

/**
 * Filtered search: combine FTS5 with SQL WHERE clauses.
 */
function searchFiltered(db, query, filters) {
  filters = filters || {};
  var sql = `
    SELECT
      d.*,
      bm25(decisions_fts, 10.0, 5.0, 2.0, 1.0) AS rank
    FROM decisions_fts f
    JOIN decisions d ON d.rowid = f.rowid
    WHERE decisions_fts MATCH ?
  `;
  var params = [query];

  if (filters.type) {
    sql += ' AND d.type = ?';
    params.push(filters.type);
  }
  if (filters.status) {
    sql += ' AND d.status = ?';
    params.push(filters.status);
  }
  if (filters.affects) {
    sql += ' AND d.affects LIKE ?';
    params.push('%' + filters.affects + '%');
  }
  if (filters.author) {
    sql += ' AND d.author = ?';
    params.push(filters.author);
  }

  sql += ' ORDER BY rank LIMIT ?';
  params.push(filters.limit || 5);

  return db.prepare(sql).all.apply(db.prepare(sql), params);
}

/**
 * Find potential contradictions: decisions with same affects but different conclusions.
 * This is a simple heuristic — real contradiction detection needs LLM.
 */
function findPotentialContradictions(db, decisionId) {
  var decision = db.prepare('SELECT * FROM decisions WHERE id = ?').get(decisionId);
  if (!decision) return [];

  var affects = JSON.parse(decision.affects);
  if (affects.length === 0) return [];

  // Find other active decisions affecting the same modules
  var conditions = affects.map(function() { return 'd.affects LIKE ?'; }).join(' OR ');
  var params = affects.map(function(a) { return '%' + a + '%'; });

  var stmt = db.prepare(
    'SELECT d.* FROM decisions d WHERE d.id != ? AND d.status = \'active\' AND (' + conditions + ') ORDER BY d.created_at DESC'
  );

  return stmt.all.apply(stmt, [decisionId].concat(params));
}

// --- Benchmark helper ---
function benchmark(name, fn, iterations) {
  iterations = iterations || 100;
  var times = [];
  for (var i = 0; i < iterations; i++) {
    var start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort(function(a, b) { return a - b; });
  var sum = 0;
  for (var j = 0; j < times.length; j++) sum += times[j];
  return {
    name: name,
    iterations: iterations,
    avg: (sum / times.length).toFixed(3),
    p50: times[Math.floor(times.length * 0.5)].toFixed(3),
    p95: times[Math.floor(times.length * 0.95)].toFixed(3),
    p99: times[Math.floor(times.length * 0.99)].toFixed(3),
    min: times[0].toFixed(3),
    max: times[times.length - 1].toFixed(3),
  };
}

// --- Main ---
function main() {
  console.log('=== Teamind SQLite + FTS5 Prototype ===\n');

  // 1. Create database
  console.log('1. Creating database...');
  var db = createDatabase();
  console.log('   DB: ' + DB_PATH + '\n');

  // 2. Insert sample data
  console.log('2. Inserting 10 sample decisions...');
  insertSampleData(db);
  var count = db.prepare('SELECT COUNT(*) as n FROM decisions').get();
  console.log('   Inserted: ' + count.n + ' decisions\n');

  // 3. Test FTS5 search queries
  console.log('3. Testing FTS5 search queries:\n');

  var queries = [
    { name: 'Exact term: "PostgreSQL"', query: 'PostgreSQL' },
    { name: 'Concept: "database"', query: 'database' },
    { name: 'Concept: "authentication"', query: 'authentication' },
    { name: 'Concept: "performance"', query: 'performance' },
    { name: 'Multi-word: "circuit breaker"', query: '"circuit breaker"' },
    { name: 'OR query: "Redis OR caching"', query: 'Redis OR caching' },
    { name: 'Module search: "payment"', query: 'payment' },
    { name: 'Stemming test: "failures" (should match "failure")', query: 'failures' },
    { name: 'Prefix search: "event*"', query: 'event*' },
    { name: 'NOT query: "database NOT analytics"', query: 'database NOT analytics' },
  ];

  for (var qi = 0; qi < queries.length; qi++) {
    var q = queries[qi];
    var results = searchFTS(db, q.query);
    console.log('   ' + q.name);
    console.log('   -> ' + results.length + ' results');
    if (results.length > 0) {
      console.log('     Top: "' + results[0].summary + '" (BM25: ' + results[0].rank.toFixed(4) + ')');
    }
    console.log();
  }

  // 4. Test filtered search
  console.log('4. Testing filtered search:\n');

  var filteredQueries = [
    { name: 'Type=decision + "database"', query: 'database', filters: { type: 'decision' } },
    { name: 'Type=constraint + "API"', query: 'API', filters: { type: 'constraint' } },
    { name: 'Affects=payment-service + "failure"', query: 'failure', filters: { affects: 'payment-service' } },
    { name: 'Author=oleg + "database"', query: 'database', filters: { author: 'oleg' } },
  ];

  for (var fi = 0; fi < filteredQueries.length; fi++) {
    var fq = filteredQueries[fi];
    var fResults = searchFiltered(db, fq.query, fq.filters);
    console.log('   ' + fq.name);
    console.log('   -> ' + fResults.length + ' results');
    if (fResults.length > 0) {
      console.log('     Top: "' + fResults[0].summary + '"');
    }
    console.log();
  }

  // 5. Test contradiction finder
  console.log('5. Testing contradiction finder:\n');
  var allDecisions = db.prepare('SELECT * FROM decisions').all();
  var pgDecision = null;
  for (var di = 0; di < allDecisions.length; di++) {
    if (allDecisions[di].summary.indexOf('PostgreSQL') !== -1) {
      pgDecision = allDecisions[di];
      break;
    }
  }
  if (pgDecision) {
    var related = findPotentialContradictions(db, pgDecision.id);
    console.log('   Decision: "' + pgDecision.summary + '"');
    console.log('   Affects: ' + pgDecision.affects);
    console.log('   Related decisions in same modules (' + related.length + '):');
    for (var ri = 0; ri < related.length; ri++) {
      console.log('     - "' + related[ri].summary + '" (type: ' + related[ri].type + ', affects: ' + related[ri].affects + ')');
    }
    console.log();
  }

  // 6. Benchmarks
  console.log('6. Performance benchmarks (100 iterations each):\n');

  var benchmarks = [
    benchmark('FTS5 search: "database"', function() { searchFTS(db, 'database'); }),
    benchmark('FTS5 search: "payment OR authentication"', function() { searchFTS(db, 'payment OR authentication'); }),
    benchmark('FTS5 search: "circuit breaker"', function() { searchFTS(db, '"circuit breaker"'); }),
    benchmark('Filtered: type=decision + "database"', function() { searchFiltered(db, 'database', { type: 'decision' }); }),
    benchmark('Filtered: affects=payment', function() { searchFiltered(db, 'payment', { affects: 'payment-service' }); }),
    benchmark('Full table scan: SELECT *', function() { db.prepare('SELECT * FROM decisions').all(); }),
    benchmark('Count by type', function() { db.prepare('SELECT type, COUNT(*) FROM decisions GROUP BY type').all(); }),
  ];

  console.log('   ' + pad('Query', 55) + 'Avg(ms)  P50(ms)  P95(ms)  P99(ms)');
  console.log('   ' + repeat('-', 95));
  for (var bi = 0; bi < benchmarks.length; bi++) {
    var b = benchmarks[bi];
    console.log('   ' + pad(b.name, 55) + ' ' + lpad(b.avg, 6) + '   ' + lpad(b.p50, 6) + '   ' + lpad(b.p95, 6) + '   ' + lpad(b.p99, 6));
  }

  console.log('\n7. Database stats:\n');
  var stats = fs.statSync(DB_PATH);
  console.log('   File size: ' + (stats.size / 1024).toFixed(1) + ' KB');
  console.log('   Decisions: ' + count.n);
  console.log('   FTS5 index: enabled (porter stemming + unicode61)');
  console.log('   WAL mode: enabled');

  // 8. sqlite-vec test (optional)
  console.log('\n8. sqlite-vec vector search test:\n');
  try {
    var sqliteVec = require('sqlite-vec');
    sqliteVec.load(db);
    console.log('   sqlite-vec loaded successfully!');

    // Create vector table (384-dim for all-MiniLM-L6-v2 embeddings)
    db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS decisions_vec USING vec0(decision_id TEXT, embedding float[384])');

    // Insert fake embeddings (in real use, these come from a model)
    var insertVec = db.prepare('INSERT INTO decisions_vec(decision_id, embedding) VALUES (?, ?)');

    for (var vi = 0; vi < Math.min(3, allDecisions.length); vi++) {
      var fakeEmb = JSON.stringify(Array.from({ length: 384 }, function() { return Math.random() * 2 - 1; }));
      insertVec.run(allDecisions[vi].id, fakeEmb);
    }

    // Query with a random vector
    var queryVec = JSON.stringify(Array.from({ length: 384 }, function() { return Math.random() * 2 - 1; }));
    var vecResults = db.prepare('SELECT decision_id, distance FROM decisions_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 3').all(queryVec);

    console.log('   Vector search results: ' + vecResults.length + ' (with random embeddings)');
    for (var vri = 0; vri < vecResults.length; vri++) {
      console.log('     - ID: ' + vecResults[vri].decision_id.substring(0, 8) + '... distance: ' + vecResults[vri].distance.toFixed(4));
    }

    var vecBench = benchmark('Vector search (384-dim, 3 rows)', function() {
      db.prepare('SELECT decision_id, distance FROM decisions_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 3').all(queryVec);
    });
    console.log('\n   Vector search latency: avg=' + vecBench.avg + 'ms, p95=' + vecBench.p95 + 'ms');

  } catch (err) {
    console.log('   sqlite-vec not available: ' + err.message);
    console.log('   This is expected if "npm install sqlite-vec" was not run.');
    console.log('   For MVP, FTS5-only search works. Add sqlite-vec later for semantic search.');
  }

  // Cleanup
  db.close();

  // 9. Verdict
  console.log('\n' + repeat('=', 70));
  console.log('VERDICT: SQLite + FTS5 vs Qdrant for Teamind MVP (<500 decisions)');
  console.log(repeat('=', 70));
  console.log([
    '',
    'FTS5 STRENGTHS for MVP:',
    '+ Zero infrastructure -- single file, no Docker, no cloud dependency',
    '+ Sub-millisecond queries for <500 decisions',
    '+ Porter stemming handles English word variations ("running" -> "run")',
    '+ BM25 ranking is the industry standard for keyword relevance',
    '+ Prefix search, phrase search, boolean operators (AND/OR/NOT)',
    '+ Trivially portable -- copy one .db file',
    '+ WAL mode handles concurrent reads from multiple MCP server processes',
    '+ Combined with SQL filters (type, status, affects) = powerful enough for MVP',
    '',
    'FTS5 WEAKNESSES:',
    '- No semantic understanding ("auth" won\'t match "authentication" unless stemmed)',
    '- No "similar meaning" search (user asks "caching strategy" -> won\'t find "Redis for sessions")',
    '- Works for explicit keyword recall, fails for conceptual discovery',
    '- No multilingual stemming in default tokenizer',
    '',
    'HYBRID APPROACH (recommended for MVP):',
    '-> SQLite + FTS5 as default storage (free tier, zero dependencies)',
    '-> sqlite-vec for local vector search when user provides embedding API key',
    '-> Qdrant as upgrade path (paid tier, cloud-managed)',
    '',
    'This gives Teamind a genuinely free tier with zero Docker dependency.',
    'FTS5 is "good enough" for <500 decisions where users search with explicit',
    'keywords ("PostgreSQL", "payment service", "circuit breaker").',
    '',
    'The moment users need "find decisions about data consistency" to also',
    'return the event sourcing pattern -- that\'s when they need vector search,',
    'which becomes the upgrade trigger to paid/Qdrant tier.',
    '',
  ].join('\n'));

  // Cleanup test DB
  try { fs.unlinkSync(DB_PATH); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(DB_PATH + '-wal'); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(DB_PATH + '-shm'); } catch (e) { /* ignore */ }
}

// --- Utility functions ---
function pad(str, len) {
  while (str.length < len) str += ' ';
  return str;
}

function lpad(str, len) {
  while (str.length < len) str = ' ' + str;
  return str;
}

function repeat(ch, n) {
  var s = '';
  for (var i = 0; i < n; i++) s += ch;
  return s;
}

main();
