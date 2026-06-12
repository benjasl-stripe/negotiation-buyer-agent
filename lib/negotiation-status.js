/** @param {string} text */
export function lastNonEmptyLine(text) {
  if (!text || typeof text !== 'string') return '';
  const lines = text.trimEnd().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line) return line;
  }
  return '';
}

/**
 * Explicit STATUS line on the last non-empty line.
 * @param {string} text
 * @returns {'agreed' | 'walked' | null}
 */
export function parseStatus(text) {
  const last = lastNonEmptyLine(text);
  if (!last) return null;
  if (/^STATUS:\s*AGREED\b/i.test(last)) return 'agreed';
  if (/^STATUS:\s*WALKED\b/i.test(last)) return 'walked';
  return null;
}

const CONDITIONAL_ACCEPT =
  /\b(if|unless|would accept|could accept|before i|pending|need you to|provided that|contingent on)\b/i;

/** Last-line patterns that mean the buyer is closing the deal (not hedging). */
const BUYER_ACCEPT_LAST_LINE = [
  /^STATUS:\s*AGREED\b/i,
  /^I accept(?:\b|[.:!,])/i,
  /^I agree(?:\b|[.:!,])/i,
  /^We have a deal\b/i,
  /^Deal[.!]?\s*$/i,
  /^Accepted[.!]?\s*$/i,
  /^I'll take (?:it|the offer|your offer)\b/i,
  /^I will take (?:it|the offer|your offer)\b/i,
  /^Sounds good.*\b(accept|agree|deal)\b/i,
  /^Let's do it\b/i,
  /^You have a deal\b/i,
];

/** Acceptance phrases allowed anywhere on the last line (still no conditionals). */
const BUYER_ACCEPT_ANYWHERE = [
  /\bI accept your offer\b/i,
  /\bI accept the offer\b/i,
  /\bI agree to your offer\b/i,
  /\bwe have a deal\b/i,
];

/**
 * Buyer acceptance — explicit STATUS or clear, unconditional acceptance on the last line.
 * @param {string} text
 * @returns {'agreed' | 'walked' | null}
 */
export function detectBuyerOutcome(text) {
  const status = parseStatus(text);
  if (status) return status;

  const last = lastNonEmptyLine(text);
  if (!last || CONDITIONAL_ACCEPT.test(last)) return null;
  if (/^I agree that\b/i.test(last)) return null;

  for (const re of BUYER_ACCEPT_LAST_LINE) {
    if (re.test(last)) return 'agreed';
  }
  for (const re of BUYER_ACCEPT_ANYWHERE) {
    if (re.test(last)) return 'agreed';
  }
  return null;
}

/** @param {string} text */
export function isBuyerAgreementMessage(text) {
  return detectBuyerOutcome(text) === 'agreed';
}
