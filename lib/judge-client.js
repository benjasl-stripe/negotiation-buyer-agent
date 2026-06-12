/**
 * Remote negotiation-judge-service client (facilitator-controlled).
 */

function baseUrl() {
  return (process.env.JUDGE_SERVICE_URL || '').trim().replace(/\/$/, '');
}

function headers() {
  const h = { 'Content-Type': 'application/json' };
  const k = (process.env.JUDGE_SERVICE_KEY || '').trim();
  if (k) h['x-judge-service-key'] = k;
  return h;
}

export function isJudgeServiceEnabled() {
  return !!baseUrl();
}

/**
 * @param {Record<string, unknown>} payload Judge API body
 */
export async function remoteJudgeEvaluate(payload) {
  const url = baseUrl();
  if (!url) throw new Error('JUDGE_SERVICE_URL is not set');

  const r = await fetch(`${url}/api/judge/evaluate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(typeof j.error === 'string' ? j.error : `Judge service: HTTP ${r.status}`);
  }
  return j;
}

async function publicGet(path) {
  const url = baseUrl();
  if (!url) throw new Error('JUDGE_SERVICE_URL is not set');
  const r = await fetch(`${url}${path}`, { headers: { Accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(typeof j.error === 'string' ? j.error : `Judge service: HTTP ${r.status}`);
  }
  return j;
}

export async function remoteLeaderboardList() {
  return publicGet('/api/leaderboard');
}

/** @param {string} entryId */
export async function remoteLeaderboardGet(entryId) {
  return publicGet(`/api/leaderboard/${encodeURIComponent(entryId)}`);
}
