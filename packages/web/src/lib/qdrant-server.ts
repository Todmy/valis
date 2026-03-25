/**
 * T034: Qdrant sync helper for server-side payload updates.
 *
 * Uses the Qdrant REST API directly (no SDK) to update decision payloads
 * after enrichment. Called by the /api/enrich route to keep Qdrant in sync
 * with Postgres after LLM classification.
 */

const COLLECTION_NAME = 'decisions';

/**
 * Update a decision's payload fields in Qdrant.
 *
 * Uses the Qdrant "set payload" REST endpoint to merge new fields into an
 * existing point's payload without replacing existing fields.
 *
 * @param decisionId  UUID of the decision (used as point ID in Qdrant)
 * @param orgId       Organization ID (for logging / future multi-tenant filtering)
 * @param payload     Key-value pairs to merge into the existing payload
 */
export async function updateDecisionPayload(
  decisionId: string,
  _orgId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const qdrantUrl = process.env.QDRANT_URL;
  const qdrantApiKey = process.env.QDRANT_API_KEY;

  if (!qdrantUrl) {
    throw new Error('QDRANT_URL not configured');
  }

  const url = `${qdrantUrl}/collections/${COLLECTION_NAME}/points/payload`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (qdrantApiKey) {
    headers['api-key'] = qdrantApiKey;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      payload,
      points: [decisionId],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(
      `Qdrant payload update failed (${response.status}): ${errorText}`,
    );
  }
}
