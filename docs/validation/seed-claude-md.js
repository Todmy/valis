#!/usr/bin/env node

/**
 * seed-claude-md.js
 *
 * Parses CLAUDE.md to extract rules, conventions, and patterns.
 * Classifies each as decision/constraint/pattern.
 * Outputs structured JSON.
 *
 * Usage: node seed-claude-md.js [path-to-claude-md]
 * Default path: ~/.claude/CLAUDE.md
 */

const fs = require('fs');
const path = require('path');

const filePath = process.argv[2] || path.join(process.env.HOME, '.claude', 'CLAUDE.md');

function classifyEntry(text) {
  const lower = text.toLowerCase();

  // Constraints: things you MUST/MUST NOT do, explicit prohibitions
  const constraintSignals = [
    'must', 'never', 'always', 'do not', "don't", 'avoid',
    'only when', 'only if', 'required', 'mandatory', 'important',
    'override', 'critical'
  ];

  // Decision signals: explicit choices made, tool/tech selections
  const decisionSignals = [
    'use ', 'prefer', 'switch to', 'choose', 'selected',
    'recommend', 'adopt', 'built with', 'powered by',
    'pipeline', 'method', 'best method'
  ];

  // Pattern signals: workflow descriptions, conventions
  const patternSignals = [
    'workflow', 'convention', 'approach', 'style', 'format',
    'when ', 'if ', 'pattern', 'step', 'process',
    'tone', 'mindset', 'communication'
  ];

  const constraintScore = constraintSignals.filter(s => lower.includes(s)).length;
  const decisionScore = decisionSignals.filter(s => lower.includes(s)).length;
  const patternScore = patternSignals.filter(s => lower.includes(s)).length;

  if (constraintScore > decisionScore && constraintScore > patternScore) return 'constraint';
  if (decisionScore > patternScore) return 'decision';
  if (patternScore > 0) return 'pattern';

  // Default heuristics
  if (lower.startsWith('- ') && (lower.includes('not') || lower.includes('no '))) return 'constraint';
  return 'pattern';
}

function extractConfidence(text) {
  const lower = text.toLowerCase();
  if (/must|always|never|critical|mandatory|important/i.test(lower)) return 'high';
  if (/prefer|recommend|try|consider|should/i.test(lower)) return 'medium';
  return 'low';
}

function extractDomain(text) {
  const lower = text.toLowerCase();
  if (/git|commit|push|branch|revert/i.test(lower)) return 'git';
  if (/tone|language|communication|style|paragraph|bullet/i.test(lower)) return 'communication';
  if (/qdrant|store|knowledge|memory|collection/i.test(lower)) return 'knowledge-management';
  if (/sprite|tile|pixel|swift|spritekit|isometric/i.test(lower)) return 'game-dev';
  if (/asset|pixelorama|pixellab|pxo|image/i.test(lower)) return 'asset-pipeline';
  if (/workflow|build|xcode|simulator/i.test(lower)) return 'workflow';
  return 'general';
}

function parseSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let currentSection = null;
  let currentContent = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      if (currentSection) {
        sections.push({ heading: currentSection, level: currentSection.level, content: currentContent.join('\n').trim() });
      }
      currentSection = { title: headingMatch[2], level: headingMatch[1].length };
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentSection) {
    sections.push({ heading: currentSection, content: currentContent.join('\n').trim() });
  }

  return sections;
}

function extractEntries(content) {
  const sections = parseSections(content);
  const entries = [];

  for (const section of sections) {
    const sectionTitle = section.heading.title;
    const lines = section.content.split('\n');

    // Extract bullet points as individual entries
    let currentBullet = '';
    for (const line of lines) {
      const bulletMatch = line.match(/^-\s+(.+)/);
      const subBulletMatch = line.match(/^\s+-\s+(.+)/);

      if (bulletMatch) {
        if (currentBullet) {
          entries.push({ text: currentBullet, section: sectionTitle });
        }
        currentBullet = bulletMatch[1];
      } else if (subBulletMatch && currentBullet) {
        // Sub-bullets get added as separate entries with parent context
        entries.push({ text: subBulletMatch[1], section: sectionTitle, parent: currentBullet });
      } else if (line.trim() === '' && currentBullet) {
        entries.push({ text: currentBullet, section: sectionTitle });
        currentBullet = '';
      } else if (line.trim() && !line.startsWith('#') && !line.startsWith('```') && !line.startsWith('---')) {
        // Non-bullet paragraph text — treat entire paragraphs as entries
        if (currentBullet) {
          entries.push({ text: currentBullet, section: sectionTitle });
          currentBullet = '';
        }
        if (line.trim().length > 15) { // Skip very short lines
          entries.push({ text: line.trim(), section: sectionTitle });
        }
      }
    }
    if (currentBullet) {
      entries.push({ text: currentBullet, section: sectionTitle });
    }
  }

  return entries;
}

function run() {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error(`Cannot read ${filePath}: ${err.message}`);
    process.exit(1);
  }

  const rawEntries = extractEntries(content);

  // Filter out empty/trivial entries
  const entries = rawEntries.filter(e => e.text.length > 10);

  const decisions = entries.map((entry, i) => {
    const type = classifyEntry(entry.text);
    return {
      id: `claude-md-${i + 1}`,
      source: 'CLAUDE.md',
      section: entry.section,
      parent: entry.parent || null,
      text: entry.text,
      type,
      confidence: extractConfidence(entry.text),
      domain: extractDomain(entry.text),
    };
  });

  const summary = {
    totalExtracted: decisions.length,
    byType: {
      decision: decisions.filter(d => d.type === 'decision').length,
      constraint: decisions.filter(d => d.type === 'constraint').length,
      pattern: decisions.filter(d => d.type === 'pattern').length,
    },
    byDomain: {},
    byConfidence: {
      high: decisions.filter(d => d.confidence === 'high').length,
      medium: decisions.filter(d => d.confidence === 'medium').length,
      low: decisions.filter(d => d.confidence === 'low').length,
    },
  };

  for (const d of decisions) {
    summary.byDomain[d.domain] = (summary.byDomain[d.domain] || 0) + 1;
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
