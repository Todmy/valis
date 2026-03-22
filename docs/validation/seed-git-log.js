#!/usr/bin/env node

/**
 * seed-git-log.js
 *
 * Parses git log (last 50 commits) to extract decision-like commits.
 * Filters out trivial commits (typo fixes, chores, renames).
 * Classifies remaining commits.
 * Outputs structured JSON.
 *
 * Usage: node seed-git-log.js [repo-path]
 * Default: current directory
 */

const { execFileSync } = require('child_process');
const path = require('path');

const repoPath = process.argv[2] || process.cwd();

// Patterns that indicate NON-decision commits (noise)
const noisePatterns = [
  /^chore:\s*(update|rename|remove|fix)\s/i,
  /^fix\s*typo/i,
  /^chore:\s*bump/i,
  /^merge\s/i,
  /^wip/i,
  /^initial commit$/i,
  /^update\s+readme/i,
  /^chore:\s*update\s+metrics/i,
  /^chore:\s*rename/i,
];

// Patterns that indicate DECISION-rich commits
const decisionSignals = {
  'architectural': /refactor|restructure|redesign|migrate|split|extract|reorganize/i,
  'strategic': /add.*strategy|add.*plan|add.*model|revenue|pricing|comprehensive/i,
  'tool-choice': /adopt|switch to|replace|integrate|add.*framework/i,
  'content-decision': /feat:.*add.*post on|feat:.*add.*draft/i,
  'analysis': /analysis:|scrape:|scan|research|evaluate/i,
  'framework': /framework|system|checklist|method|distilled|v\d+\.\d+/i,
  'process': /workflow|pipeline|batch|sequential|process/i,
};

function isNoise(message) {
  return noisePatterns.some(p => p.test(message));
}

function classifyCommit(message) {
  for (const [category, pattern] of Object.entries(decisionSignals)) {
    if (pattern.test(message)) return category;
  }
  return 'general';
}

function extractDecisionFromMessage(message) {
  // Try to extract the actual decision/what-was-decided from the commit message
  const cleaned = message
    .replace(/^feat:\s*/i, '')
    .replace(/^add\s*/i, '')
    .replace(/^chore:\s*/i, '');

  return cleaned;
}

function assessQuality(message) {
  const length = message.length;
  // Longer, more descriptive commits tend to be higher quality
  if (length > 80) return 'high';
  if (length > 40) return 'medium';
  return 'low';
}

function run() {
  let rawLog;
  try {
    rawLog = execFileSync(
      'git',
      ['-C', repoPath, 'log', '--oneline', '--format=%H|%s|%ai', '-50'],
      { encoding: 'utf-8' }
    );
  } catch (err) {
    console.error(`Cannot read git log: ${err.message}`);
    process.exit(1);
  }

  const lines = rawLog.trim().split('\n').filter(Boolean);
  const allCommits = lines.map(line => {
    const [hash, ...rest] = line.split('|');
    const parts = rest.join('|').split('|');
    return {
      hash: hash.substring(0, 8),
      message: parts[0] || '',
      date: parts[1] || '',
    };
  });

  const noiseCommits = allCommits.filter(c => isNoise(c.message));
  const significantCommits = allCommits.filter(c => !isNoise(c.message));

  const decisions = significantCommits.map((commit, i) => ({
    id: `git-${i + 1}`,
    source: 'git-log',
    hash: commit.hash,
    date: commit.date.trim(),
    originalMessage: commit.message,
    extractedDecision: extractDecisionFromMessage(commit.message),
    category: classifyCommit(commit.message),
    messageQuality: assessQuality(commit.message),
  }));

  // Group by category for analysis
  const byCategory = {};
  for (const d of decisions) {
    byCategory[d.category] = (byCategory[d.category] || 0) + 1;
  }

  const byQuality = {
    high: decisions.filter(d => d.messageQuality === 'high').length,
    medium: decisions.filter(d => d.messageQuality === 'medium').length,
    low: decisions.filter(d => d.messageQuality === 'low').length,
  };

  const summary = {
    totalCommitsAnalyzed: allCommits.length,
    noiseFiltered: noiseCommits.length,
    significantCommits: significantCommits.length,
    filteredMessages: noiseCommits.map(c => c.message),
    byCategory,
    byQuality,
  };

  const output = {
    meta: {
      source: repoPath,
      parsedAt: new Date().toISOString(),
      parser: 'regex/string-matching (no LLM)',
      commitRange: `${allCommits[allCommits.length - 1]?.hash}..${allCommits[0]?.hash}`,
    },
    summary,
    decisions,
  };

  console.log(JSON.stringify(output, null, 2));
}

run();
