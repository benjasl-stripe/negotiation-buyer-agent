/**
 * Leaderboard client — reads from buyer agent /api/leaderboard (proxies judge service DynamoDB).
 */
(function (global) {
  /** @param {unknown} row */
  function normalizeEntry(row) {
    const e = row && typeof row === 'object' ? row : {};
    const judge = e.judge && typeof e.judge === 'object' ? e.judge : {};
    const transcript = Array.isArray(e.transcript) ? e.transcript : [];
    return {
      id: typeof e.id === 'string' ? e.id : '',
      savedAt: typeof e.savedAt === 'string' ? e.savedAt : '',
      buyerMandate: typeof e.buyerMandate === 'string' ? e.buyerMandate : '',
      outcome: typeof e.outcome === 'string' ? e.outcome : 'unknown',
      endedBy: typeof e.endedBy === 'string' ? e.endedBy : undefined,
      whoStarts: typeof e.whoStarts === 'string' ? e.whoStarts : undefined,
      roundsCompleted: typeof e.roundsCompleted === 'number' ? e.roundsCompleted : undefined,
      transcript: transcript.map((t) => ({
        speaker: t.speaker,
        text: t.text || '',
        round: t.round,
        buyerActivity: t.buyerActivity ?? t.buyer_activity,
      })),
      negotiationSpend: e.negotiationSpend && typeof e.negotiationSpend === 'object' ? e.negotiationSpend : undefined,
      judge,
    };
  }

  async function apiGet(path) {
    const r = await fetch(path, { credentials: 'include', headers: { Accept: 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(typeof j.error === 'string' ? j.error : r.statusText || 'Request failed');
    }
    return j;
  }

  global.AgentLeaderboardStore = {
    storageBackend: 'dynamodb',

    /** @returns {Promise<ReturnType<typeof normalizeEntry>[]>} */
    async list() {
      const data = await apiGet('/api/leaderboard');
      const rows = Array.isArray(data.entries) ? data.entries : [];
      return rows.map(normalizeEntry);
    },

    /** @param {string} id @returns {Promise<ReturnType<typeof normalizeEntry> | null>} */
    async get(id) {
      if (!id) return null;
      const data = await apiGet('/api/leaderboard/' + encodeURIComponent(id));
      return data.entry ? normalizeEntry(data.entry) : null;
    },

    /** @returns {Promise<number>} */
    async count() {
      const data = await apiGet('/api/leaderboard');
      return typeof data.count === 'number' ? data.count : (data.entries || []).length;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
