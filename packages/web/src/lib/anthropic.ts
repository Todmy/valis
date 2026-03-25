/**
 * T033: Anthropic client helper for server-side enrichment.
 *
 * Calls the Anthropic Messages API with claude-sonnet-4-20250514 to classify
 * development decisions. Returns structured metadata (type, summary, affects,
 * confidence) plus token usage for cost tracking.
 *
 * Uses raw fetch() — no SDK dependency required.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 300;

const ENRICHMENT_SYSTEM_PROMPT = `Classify this development decision. Return JSON: {"type": "decision"|"constraint"|"pattern"|"lesson", "summary": "string (1 sentence)", "affects": ["areas"], "confidence": 0.0-1.0}

Rules:
- "decision": An explicit architectural or technical choice.
- "constraint": A limitation or requirement that restricts options.
- "pattern": A recurring approach or convention.
- "lesson": Something learned from experience (good or bad).
- Areas should be lowercase, hyphenated (e.g., "auth", "database", "api-design").
- Return between 1 and 10 areas.
- Summary must be a single sentence.
- Confidence is your certainty in the classification (0.0 to 1.0).
- Return ONLY valid JSON, no markdown fences.`;

export interface EnrichmentResult {
  type: 'decision' | 'constraint' | 'pattern' | 'lesson';
  summary: string;
  affects: string[];
  confidence: number;
  tokens_used: number;
}

// Cost per token in USD (Sonnet input ~$3/M, output ~$15/M, blended estimate)
const COST_PER_TOKEN_USD = 0.000006;

/**
 * Enrich a single decision text via the Anthropic Messages API.
 *
 * Returns structured metadata including token usage and estimated cost.
 * Throws on API errors or missing API key.
 */
export async function enrichDecision(
  text: string,
  apiKey: string,
): Promise<EnrichmentResult & { cost_cents: number }> {
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: ENRICHMENT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }],
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const responseText =
    data.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('') ?? '';

  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  const tokens_used = inputTokens + outputTokens;
  const cost_cents = Math.ceil(tokens_used * COST_PER_TOKEN_USD * 100);

  const parsed = parseResponse(responseText);

  return {
    ...parsed,
    tokens_used,
    cost_cents,
  };
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

const VALID_TYPES = new Set(['decision', 'constraint', 'pattern', 'lesson']);

function parseResponse(raw: string): Omit<EnrichmentResult, 'tokens_used'> {
  let cleaned = raw.trim();

  // Strip markdown code fences if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      type: 'decision',
      summary: raw.substring(0, 200).trim() || 'Classification failed',
      affects: [],
      confidence: 0,
    };
  }

  // Validate type
  const rawType = String(parsed.type ?? 'decision').toLowerCase();
  const type = VALID_TYPES.has(rawType)
    ? (rawType as EnrichmentResult['type'])
    : 'decision';

  // Validate summary
  const summary =
    String(parsed.summary ?? '').substring(0, 200).trim() ||
    'No summary provided';

  // Validate affects
  let affects: string[] = [];
  if (Array.isArray(parsed.affects)) {
    affects = parsed.affects
      .filter((a): a is string => typeof a === 'string' && a.length > 0)
      .map((a) => a.toLowerCase().trim())
      .slice(0, 10);
  }

  // Validate confidence
  let confidence = Number(parsed.confidence ?? 0);
  if (isNaN(confidence) || confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;

  return { type, summary, affects, confidence };
}
