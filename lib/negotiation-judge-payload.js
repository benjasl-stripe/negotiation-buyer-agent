/**
 * Build negotiation-judge-service request body from a completed lab negotiation.
 */

import { isBuyerAgreementMessage, parseStatus } from './negotiation-status.js';

const DEFAULT_ASK_USD = Number(process.env.NEGOTIATION_DEFAULT_ASK_USD || '629900') || 629900;
const MIN_PURCHASE_USD = 350_000;
const MAX_PURCHASE_USD = 2_500_000;

/**
 * @param {string} raw
 */
function parsePriceToken(raw) {
  const t = String(raw).replace(/,/g, '').trim();
  const mk = t.match(/^([\d.]+)[kK]$/);
  if (mk) {
    const n = parseFloat(mk[1]);
    return Number.isFinite(n) ? Math.round(n * 1000) : null;
  }
  const md = t.match(/^([\d.]+)$/);
  if (md) {
    const n = parseFloat(md[1]);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

/**
 * @param {string} text
 */
function extractPurchasePrices(text) {
  const prices = [];
  const full = String(text || '');
  const re = /\$[\d]{1,3}(?:,\d{3})+(?:\.\d{2})?|\$[\d]+(?:\.\d{2})?|\$[\d.,]+[kK]\b/gi;
  for (const match of full.matchAll(re)) {
    const raw = match[0].slice(1);
    const val = parsePriceToken(/[kK]\b/.test(raw) ? raw.replace(/,/g, '') : raw.replace(/,/g, ''));
    if (val != null && val >= MIN_PURCHASE_USD && val <= MAX_PURCHASE_USD) prices.push(val);
  }
  return prices;
}

/**
 * @param {{ speaker: string, text: string }[]} transcript
 */
export function inferSellerStartingAsk(transcript) {
  const firstSeller = transcript.find((t) => t.speaker === 'seller');
  if (!firstSeller) return DEFAULT_ASK_USD;
  const prices = extractPurchasePrices(firstSeller.text);
  if (!prices.length) return DEFAULT_ASK_USD;
  return Math.max(...prices);
}

/**
 * @param {{ speaker: string, text: string }[]} transcript
 * @param {string} outcome
 */
export function inferFinalAgreedPrice(transcript, outcome) {
  if (outcome !== 'agreed') return null;

  for (let i = transcript.length - 1; i >= 0; i--) {
    const row = transcript[i];
    const text = row.text || '';
    const terminating =
      parseStatus(text) === 'agreed' ||
      (row.speaker === 'buyer' && isBuyerAgreementMessage(text)) ||
      (row.speaker === 'seller' && parseStatus(text) === 'agreed');
    if (!terminating) continue;
    const prices = extractPurchasePrices(text);
    if (prices.length) return prices[prices.length - 1];
  }

  for (let i = transcript.length - 1; i >= 0; i--) {
    const prices = extractPurchasePrices(transcript[i].text);
    if (prices.length) return Math.min(...prices);
  }
  return null;
}

/**
 * @param {{ buyerActivity?: unknown[], buyer_activity?: unknown[] }[]} transcript
 */
function toolsFromTranscriptActivity(transcript) {
  /** @type {string[]} */
  const tools = [];
  const seen = new Set();
  for (const row of transcript) {
    const activity = row.buyerActivity ?? row.buyer_activity;
    if (!Array.isArray(activity)) continue;
    for (const step of activity) {
      const text = typeof step === 'string' ? step : step && typeof step.text === 'string' ? step.text : '';
      for (const m of text.matchAll(/`([a-z][a-z0-9_]*)`/gi)) {
        const name = m[1];
        if (name.startsWith('property_') && !seen.has(name)) {
          seen.add(name);
          tools.push(name);
        }
      }
    }
  }
  return tools;
}

/**
 * @param {import('express-session').Session & Record<string, unknown>} [session]
 */
function toolsFromSession(session) {
  const log = session && Array.isArray(session.negRunSpendLog) ? session.negRunSpendLog : [];
  return [...new Set(log.map((r) => r.toolName).filter(Boolean))];
}

/**
 * @param {import('express-session').Session & Record<string, unknown>} [session]
 */
function perToolSpendFromSession(session) {
  const log = session && Array.isArray(session.negRunSpendLog) ? session.negRunSpendLog : [];
  return log.map((r) => ({
    tool: r.toolName,
    amount_usd: Math.round(r.amountCents) / 100,
  }));
}

/**
 * @param {{
 *   buyerGoal?: string,
 *   outcome: string,
 *   transcript: { speaker: string, text: string, round?: number, buyerActivity?: unknown[] }[],
 *   roundsCompleted?: number,
 *   negotiationSpend?: { spentCents?: number, toolCallCount?: number, toolsUsed?: string[], perToolSpend?: { tool: string, amount_usd: number }[] },
 *   seller_starting_ask?: number,
 *   final_price?: number | null,
 * }} negResult
 * @param {import('express-session').Session & Record<string, unknown>} [session]
 */
export function buildJudgePayload(negResult, session) {
  const transcript = Array.isArray(negResult.transcript) ? negResult.transcript : [];
  const outcome =
    negResult.outcome === 'agreed' || negResult.outcome === 'walked' || negResult.outcome === 'max_rounds'
      ? negResult.outcome
      : 'max_rounds';

  const spend = negResult.negotiationSpend || {};
  const mppSpendUsd =
    typeof spend.spentCents === 'number' && Number.isFinite(spend.spentCents)
      ? spend.spentCents / 100
      : 0;

  const sessionTools = toolsFromSession(session);
  const transcriptTools = toolsFromTranscriptActivity(transcript);
  const toolsUsed = [
    ...new Set([
      ...(Array.isArray(spend.toolsUsed) ? spend.toolsUsed : []),
      ...sessionTools,
      ...transcriptTools,
    ]),
  ];

  let perToolSpend = Array.isArray(spend.perToolSpend) ? spend.perToolSpend : perToolSpendFromSession(session);
  if (!perToolSpend.length && toolsUsed.length && mppSpendUsd > 0) {
    const each = mppSpendUsd / toolsUsed.length;
    perToolSpend = toolsUsed.map((tool) => ({ tool, amount_usd: Math.round(each * 100) / 100 }));
  }

  const toolCallCount =
    typeof spend.toolCallCount === 'number'
      ? spend.toolCallCount
      : session && typeof session.negRunToolCallCount === 'number'
        ? session.negRunToolCallCount
        : toolsUsed.length;

  const sellerStartingAsk =
    typeof negResult.seller_starting_ask === 'number' && negResult.seller_starting_ask > 0
      ? Math.round(negResult.seller_starting_ask)
      : inferSellerStartingAsk(transcript);

  let finalPrice =
    negResult.final_price != null && negResult.final_price !== ''
      ? Math.round(Number(negResult.final_price))
      : inferFinalAgreedPrice(transcript, outcome);

  if (finalPrice != null && Number.isNaN(finalPrice)) finalPrice = null;

  return {
    transcript: transcript.map((t) => ({
      speaker: t.speaker,
      text: t.text,
      round: t.round,
      buyerActivity: t.buyerActivity ?? t.buyer_activity,
    })),
    buyer_mandate: typeof negResult.buyerGoal === 'string' ? negResult.buyerGoal.trim() : '',
    seller_starting_ask: sellerStartingAsk,
    final_price: finalPrice,
    outcome,
    mpp_spend_usd: mppSpendUsd,
    tool_call_count: toolCallCount,
    tools_used: toolsUsed,
    per_tool_spend: perToolSpend,
    rounds_completed:
      typeof negResult.roundsCompleted === 'number'
        ? negResult.roundsCompleted
        : transcript.filter((t) => t.speaker === 'buyer').length,
  };
}
