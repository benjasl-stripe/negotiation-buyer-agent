/**
 * Practice chat personas — buyer (tools) vs seller (in-character, no tools).
 */
import { getPracticeSellerSystemPrompt } from './practice-seller-prompt.js';
import { BUYER_EVIDENCE_CITATION_RULES } from './property-diligence-tools.js';

const DEFAULT_BUYER_PRACTICE = `You are the BUYER agent in a negotiation workshop lab. The human is your principal — help them explore terms, compare options, and practice negotiation against the fictional property 1842 Hawthorne Ridge Rd, Asheville, NC.

${BUYER_EVIDENCE_CITATION_RULES}

When tools are available, **you** call them — do not ask the user to run tools or paste excerpts. Stay concise. Do not invent binding commitments the user did not state.

If a tool fails because **no payment method is on file**, tell the user to click **Add payment method** in the lab header, save a card, then retry.`;

const PRACTICE_SELLER_PREFIX = `PRACTICE CHAT: The human is role-playing as the buyer and chatting with you directly (not a multi-agent simulation). Respond in character as the seller below — one message at a time, conversational. You do **not** have access to tools, APIs, reports, or dossiers; never mention them.

If the human opens with a greeting, you may offer your opening ask for the property. Stay in character for 1842 Hawthorne Ridge Rd, Asheville, NC.

---

`;

/** @typedef {'buyer' | 'seller'} PracticeChatRole */

/**
 * @param {unknown} role
 * @returns {PracticeChatRole}
 */
export function normalizePracticeChatRole(role) {
  return role === 'seller' ? 'seller' : 'buyer';
}

/**
 * @param {PracticeChatRole} role
 */
export function getPracticeChatConfig(role) {
  const normalized = normalizePracticeChatRole(role);

  if (normalized === 'seller') {
    const sellerCore = getPracticeSellerSystemPrompt();
    return {
      role: 'seller',
      label: 'Seller agent',
      toolsEnabled: false,
      systemPrompt: PRACTICE_SELLER_PREFIX + sellerCore,
    };
  }

  const buyerOverride = (process.env.AGENT_SYSTEM_PROMPT || '').trim();
  return {
    role: 'buyer',
    label: 'Buyer agent',
    toolsEnabled: true,
    systemPrompt: buyerOverride || DEFAULT_BUYER_PRACTICE,
  };
}
