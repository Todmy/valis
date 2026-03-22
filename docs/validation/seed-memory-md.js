#!/usr/bin/env node

/**
 * seed-memory-md.js
 *
 * Parses MEMORY.md to extract knowledge entries.
 * Classifies each as decision/insight/reference/status.
 * Outputs structured JSON.
 *
 * Usage: node seed-memory-md.js [path-to-memory-md]
 */

const fs = require('fs');
const path = require('path');

const defaultPath = path.join(
  process.env.HOME,
  '.claude/projects/-Users-todmy-PBaaS/memory/MEMORY.md'
);
const filePath = process.argv[2] || defaultPath;

function classifyEntry(text, sectionTitle) {
  const lower = text.toLowerCase();

  // Status: things that happened, dates, submissions
  const statusSignals = [
    'submitted', 'validated', 'published', 'completed', 'done',
    'updated', 'superseded', 'next:', 'target:', 'application'
  ];

  // Decision: explicit choices, strategies, selections
  const decisionSignals = [
    'path:', 'model:', 'strategy', 'raise to', 'choose', 'use ',
    'collection name', 'certification path', 'master plan',
    'pricing', 'target'
  ];

  // Insight: learned knowledge, discoveries, key findings
  const insightSignals = [
    'key insight', 'insight:', 'important', 'produces',
    'improvement', 'underpriced', 'cheapest', 'validated through'
  ];

  // Reference: pointers to other files
  const referenceSignals = [
    'see [', 'see:', 'files:', 'full research', 'indexed in'
  ];

  const statusScore = statusSignals.filter(s => lower.includes(s)).length;
  const decisionScore = decisionSignals.filter(s => lower.includes(s)).length;
  const insightScore = insightSignals.filter(s => lower.includes(s)).length;
  const referenceScore = referenceSignals.filter(s => lower.includes(s)).length;

  const maxScore = Math.max(statusScore, decisionScore, insightScore, referenceScore);

  if (maxScore === 0) return 'knowledge';
  if (referenceScore === maxScore) return 'reference';
  if (insightScore === maxScore) return 'insight';
  if (decisionScore === maxScore) return 'decision';
  return 'status';
}

function extractDomain(text, sectionTitle) {
  const combined = (sectionTitle + ' ' + text).toLowerCase();

  if (/linkedin|post|content|ego.?bait|analytics/i.test(combined)) return 'content-strategy';
  if (/bike|merida|olx|pricing|sale/i.test(combined)) return 'side-project';
  if (/qdrant|collection/i.test(combined)) return 'infrastructure';
  if (/consult|audit|compliance|certification|aigp|revenue/i.test(combined)) return 'business-strategy';
  if (/brand|positioning|pillar|identity/i.test(combined)) return 'brand';
  if (/rule.*rule|invisible.*law|system.*v/i.test(combined)) return 'research';
  if (/agent|workflow|batch|sequential/i.test(combined)) return 'agent-workflow';
  return 'general';
}

function extractActionability(text) {
  const lower = text.toLowerCase();
  if (/next:|target:|raise to|must|should/i.test(lower)) return 'actionable';
  if (/see \[|files:|indexed/i.test(lower)) return 'reference';
  return 'informational';
}

function run() {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error(`Cannot read ${filePath}: ${err.message}`);
    process.exit(1);
  }

  const lines = content.split('\n');
  const entries = [];
  let currentSection = '';

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      currentSection = headingMatch[1];
      continue;
    }

    const bulletMatch = line.match(/^-\s+(.+)/);
    if (bulletMatch) {
      const text = bulletMatch[1].trim();
      if (text.length > 10) {
        entries.push({
          text,
          section: currentSection,
        });
      }
    }
  }

  const decisions = entries.map((entry, i) => {
    const type = classifyEntry(entry.text, entry.section);
    return {
      id: `memory-md-${i + 1}`,
      source: 'MEMORY.md',
      section: entry.section,
      text: entry.text,
      type,
      domain: extractDomain(entry.text, entry.section),
      actionability: extractActionability(entry.text),
    };
  });

  const summary = {
    totalExtracted: decisions.length,
    byType: {},
    byDomain: {},
    byActionability: {},
  };

  for (const d of decisions) {
    summary.byType[d.type] = (summary.byType[d.type] || 0) + 1;
    summary.byDomain[d.domain] = (summary.byDomain[d.domain] || 0) + 1;
    summary.byActionability[d.actionability] = (summary.byActionability[d.actionability] || 0) + 1;
  }

  const output = {
    meta: {
      source: filePath,
      parsedAt: new Date().toISOString(),
      parser: 'regex/string-matching (no LLM)',
    },
    summary,
    decisions,
  };

  console.log(JSON.stringify(output, null, 2));
}

run();
