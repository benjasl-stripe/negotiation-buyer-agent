/**
 * Remote seller-service (facilitator-controlled). Negotiation **requires** `SELLER_SERVICE_URL`;
 * buyer-side `SELLER_SYSTEM_PROMPT` / API body seller overrides are not used.
 */

function baseUrl() {
  return (process.env.SELLER_SERVICE_URL || '').trim().replace(/\/$/, '');
}

function headers() {
  const h = { 'Content-Type': 'application/json' };
  const k = (process.env.SELLER_SERVICE_KEY || '').trim();
  if (k) h['x-seller-service-key'] = k;
  return h;
}

export function isExternalSellerEnabled() {
  return !!baseUrl();
}

/**
 * @param {string} buyerGoal
 */
export async function remoteSellerOpening(buyerGoal) {
  const r = await fetch(`${baseUrl()}/api/seller/opening`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ buyerGoal }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Seller service: HTTP ${r.status}`);
  const text = typeof j.text === 'string' ? j.text.trim() : '';
  if (!text) throw new Error('Seller service returned empty text');
  return text;
}

/**
 * @param {{ buyerGoal: string, transcript: { speaker: string, text: string }[], buyerLastMessage: string, round?: number, maxRounds?: number, buyerTurnCount?: number, buyerToolsPurchased?: string[] }} p
 */
export async function remoteSellerReply(p) {
  const r = await fetch(`${baseUrl()}/api/seller/reply`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      buyerGoal: p.buyerGoal,
      transcript: p.transcript,
      buyerLastMessage: p.buyerLastMessage,
      round: p.round,
      maxRounds: p.maxRounds,
      buyerTurnCount: p.buyerTurnCount,
      buyerToolsPurchased: Array.isArray(p.buyerToolsPurchased) ? p.buyerToolsPurchased : [],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Seller service: HTTP ${r.status}`);
  const text = typeof j.text === 'string' ? j.text.trim() : '';
  if (!text) throw new Error('Seller service returned empty text');
  return text;
}
