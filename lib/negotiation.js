/**
 * Orchestrates buyer agent (tools + runConversation) vs **remote seller-service only**
 * (`SELLER_SERVICE_URL`, e.g. facilitator Lambda or local `npm run seller-service`).
 */
import { runConversation, isOpenAIConfigured } from './openai.js';
import { isExternalSellerEnabled, remoteSellerReply } from './seller-client.js';
import {
  resetNegotiationSpend,
  endNegotiationSpend,
  getNegotiationSpendSummary,
} from './agent-wallet.js';
import { detectBuyerOutcome, parseStatus } from './negotiation-status.js';
import {
  BUYER_EVIDENCE_CITATION_RULES,
  collectToolsFromBuyerActivity,
  collectToolsFromNegotiationSession,
  mergePurchasedTools,
} from './property-diligence-tools.js';

const DEFAULT_BUYER_NEGOTIATION = `You are the BUYER side in a live practice negotiation against a separate seller AI.
Each user message includes the latest thing the seller said (or opens the thread). Advance your side toward the mandate: better price, terms, or clarity — without inventing facts.

${BUYER_EVIDENCE_CITATION_RULES}

**Tools — you call them; nobody else:** Manifest tools are available only to you. Do **not** ask the seller or your human to fetch data. Silently call tools, read results, then speak to the seller in plain negotiation language.

If a gated property tool fails because **no payment method is on file**, briefly tell the user to click **Add payment method** in the lab header, save a card, then try again.

When you accept the current offer or the mandate is satisfied, **stop negotiating** — the session ends immediately and the seller will not reply again. End your message with a new final line exactly: STATUS: AGREED (or state clearly on the last line that you accept, e.g. "I accept your offer").

Use STATUS: WALKED on the final line only when you are definitively ending without a deal. Do not add STATUS lines while still negotiating.`;

/** Buyer always speaks first; seller replies each round. */
const WHO_STARTS = 'buyer';

/** Fixed cap: buyer then seller each round. */
const NEGOTIATION_MAX_ROUNDS = 15;

/**
 * @param {{ buyerGoal: string, maxRounds?: number, buyerSystemPrompt?: string, onProgress?: (evt: Record<string, unknown>) => void, mppInvoke?: { session: import('express-session').Session, mintSpt?: () => Promise<string|null> }, mintSpt?: () => Promise<string|null> }} opts
 */
export async function runNegotiation(opts) {
  if (!isOpenAIConfigured()) {
    throw new Error('OpenAI not configured — set LAMBDA_ENDPOINT + WORKSHOP_SECRET or OPENAI_API_KEY in .env');
  }

  if (!isExternalSellerEnabled()) {
    throw new Error(
      'SELLER_SERVICE_URL is not set. Negotiation always uses the remote seller-service (e.g. facilitator Lambda). Set SELLER_SERVICE_URL in .env to your seller API base URL (no trailing slash). Optional: SELLER_SERVICE_KEY for X-Seller-Service-Key.'
    );
  }

  const buyerGoal = (opts.buyerGoal || '').trim();
  if (!buyerGoal) throw new Error('buyerGoal is required');

  const maxRounds = NEGOTIATION_MAX_ROUNDS;

  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const emit = (evt) => {
    if (!onProgress) return;
    try {
      onProgress(evt);
    } catch (_) {
      /* ignore UI/stream errors */
    }
  };

  const negSession = opts.mppInvoke?.session;
  if (negSession) {
    resetNegotiationSpend(negSession);
    emit({ type: 'negotiation_spend', ...getNegotiationSpendSummary(negSession) });
  }

  const buyerSystem =
    (opts.buyerSystemPrompt || process.env.NEGOTIATION_BUYER_SYSTEM_PROMPT || '').trim() ||
    DEFAULT_BUYER_NEGOTIATION;

  /** @type {{ speaker: 'buyer'|'seller', text: string, round: number, buyerActivity?: unknown[] }[]} */
  const transcript = [];
  /** @type {{ role: string, content?: string }[]} */
  const buyerMsgs = [
    {
      role: 'user',
      content: `## Mandate (from your human)\n${buyerGoal}\n\n---\nThe seller has not spoken yet. Open the negotiation: greet them and ask for their opening position.`,
    },
  ];

  let round = 0;
  let outcome = 'max_rounds';
  /** @type {'buyer'|'seller'|null} */
  let endedBy = null;
  /** @type {string[]} */
  let buyerToolsPurchased = [];

  try {
  for (; round < maxRounds; round++) {
    const buyerStatusMsg =
      round === 0 ? 'Buyer is considering how to open…' : 'Buyer is reading the thread and considering a reply…';
    emit({ type: 'status', phase: 'buyer', round: round + 1, message: buyerStatusMsg });

    const buyerOut = await runConversation(buyerMsgs, {
      systemPrompt: buyerSystem,
      onActivity: (step) => {
        emit({ type: 'buyer_trace', round: round + 1, step });
        if (step.t === 'tool_result' && negSession) {
          emit({ type: 'spend_refresh', negotiation: getNegotiationSpendSummary(negSession) });
        }
      },
      mppInvoke: opts.mppInvoke,
      mintSpt: opts.mintSpt,
    });
    if (negSession) {
      emit({ type: 'spend_refresh', negotiation: getNegotiationSpendSummary(negSession) });
    }
    const buyerText = (buyerOut.content || '').trim();
    if (!buyerText) throw new Error('Buyer returned empty message');

    buyerToolsPurchased = mergePurchasedTools(
      buyerToolsPurchased,
      collectToolsFromBuyerActivity(buyerOut.activity),
      collectToolsFromNegotiationSession(negSession)
    );

    transcript.push({
      speaker: 'buyer',
      text: buyerText,
      round: round + 1,
      buyerActivity: buyerOut.activity,
    });
    emit({
      type: 'message',
      speaker: 'buyer',
      round: round + 1,
      text: buyerText,
      buyerActivity: buyerOut.activity,
    });

    const bStatus = detectBuyerOutcome(buyerText);
    if (bStatus === 'agreed' || bStatus === 'walked') {
      outcome = bStatus;
      endedBy = 'buyer';
      break;
    }

    buyerMsgs.push({ role: 'assistant', content: buyerText });

    emit({ type: 'status', phase: 'seller', round: round + 1, message: 'Seller is reading and considering a reply…' });

    const sellerText = await remoteSellerReply({
      transcript: transcript.map((t) => ({ speaker: t.speaker, text: t.text })),
      buyerLastMessage: buyerText,
      round: round + 1,
      maxRounds,
      buyerTurnCount: round + 1,
      buyerToolsPurchased,
    });
    const sellerTrim = (sellerText || '').trim();
    if (!sellerTrim) throw new Error('Seller returned empty message');

    transcript.push({ speaker: 'seller', text: sellerTrim, round: round + 1 });
    emit({ type: 'message', speaker: 'seller', round: round + 1, text: sellerTrim });
    buyerMsgs.push({
      role: 'user',
      content:
        `Seller:\n"""${sellerTrim}"""\n\nReply as the buyer's agent.` +
        (round + 1 >= 2
          ? `\n\n(Buyer turn ${round + 1} of ${maxRounds} — either side may end early. If there is no progress, the seller won't move, or your mandate is unreachable, you may end your message with STATUS: WALKED as the final line.)`
          : ''),
    });

    const sStatus = parseStatus(sellerTrim);
    if (sStatus === 'agreed' || sStatus === 'walked') {
      outcome = sStatus;
      endedBy = 'seller';
      break;
    }
  }

  const negotiationSpend = negSession ? getNegotiationSpendSummary(negSession) : null;
  const result = {
    outcome,
    endedBy,
    maxRounds,
    whoStarts: WHO_STARTS,
    transcript,
    roundsCompleted: transcript.filter((t) => t.speaker === 'buyer').length,
    negotiationSpend,
    buyerToolsPurchased,
  };
  emit({ type: 'done', ...result });
  return result;
  } finally {
    if (negSession) endNegotiationSpend(negSession);
  }
}
