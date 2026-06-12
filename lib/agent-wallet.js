/**
 * Saved payment method for MPP: Stripe Customer + SetupIntent (Elements),
 * then mint Shared Payment Tokens (SPT) from that card on each paid tool call.
 *
 * Env (agent / .env):
 * - STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY
 * - MPP_SPT_MINT_MODE — test_helper (default for sk_test_) | issued
 * - MPP_SELLER_NETWORK_BUSINESS_PROFILE — for issued mode
 * - STRIPE_API_VERSION, MPP_SPT_* — optional SPT limits
 */

import Stripe from 'stripe';

function sk() {
  return (process.env.STRIPE_SECRET_KEY || '').trim();
}

/** @type {Stripe | null} */
let stripeSingleton = null;

function getStripe() {
  if (!sk()) return null;
  if (!stripeSingleton) {
    const v = (process.env.STRIPE_API_VERSION || '').trim();
    /** @type {import('stripe').Stripe.StripeConfig} */
    const cfg = {};
    if (v) cfg.apiVersion = v;
    stripeSingleton = new Stripe(sk(), cfg);
  }
  return stripeSingleton;
}

function rawRequestOptions() {
  const v = (process.env.STRIPE_API_VERSION || '').trim();
  return v ? { apiVersion: v } : {};
}

/** @returns {'issued' | 'test_helper'} */
export function walletSptMintMode() {
  const raw = (process.env.MPP_SPT_MINT_MODE || '').trim().toLowerCase();
  if (raw === 'test_helper' || raw === 'test_helpers') return 'test_helper';
  if (raw === 'issued') return 'issued';
  if (sk().startsWith('sk_test_')) return 'test_helper';
  return 'issued';
}

export function isWalletStripeConfigured() {
  const hasSk = !!sk();
  const hasPk = !!(process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
  if (walletSptMintMode() === 'test_helper') return hasSk && hasPk;
  return hasSk && hasPk && !!mppSellerProfile();
}

export function walletPublishableKey() {
  return (process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
}

/** Stripe docs: test seller profile for issued tokens in test mode. */
const STRIPE_DOC_TEST_SELLER_NETWORK_PROFILE =
  'profile_test_61TU90nIeGjU7NNVXA6TU90m7ISQWsBxpcx9lASWWXTk';

function mppSellerProfile() {
  const explicit = (process.env.MPP_SELLER_NETWORK_BUSINESS_PROFILE || '').trim();
  if (explicit) return explicit;
  if ((process.env.MPP_USE_DEFAULT_TEST_SELLER_PROFILE || '1').trim() === '0') return '';
  const key = sk();
  if (key.startsWith('sk_test_')) return STRIPE_DOC_TEST_SELLER_NETWORK_PROFILE;
  return '';
}

const MAX_SPEND_LOG = 50;

/** Default MPP tool cost for session spend tally (USD). */
export function mppToolCostCents() {
  const raw = (process.env.MPP_LAB_TOOL_COST_USD || '0.50').trim();
  const usd = parseFloat(raw);
  if (!Number.isFinite(usd) || usd <= 0) return 50;
  return Math.max(1, Math.round(usd * 100));
}

/**
 * @param {import('express-session').Session & Record<string, unknown>} session
 */
function ensureMppSpend(session) {
  if (typeof session.mppSpentCents !== 'number' || Number.isNaN(session.mppSpentCents)) {
    session.mppSpentCents = 0;
  }
  if (typeof session.mppToolCallCount !== 'number' || Number.isNaN(session.mppToolCallCount)) {
    session.mppToolCallCount = 0;
  }
  if (!Array.isArray(session.mppSpendLog)) session.mppSpendLog = [];
}

function ensureNegSpend(session) {
  if (typeof session.negRunSpentCents !== 'number' || Number.isNaN(session.negRunSpentCents)) {
    session.negRunSpentCents = 0;
  }
  if (typeof session.negRunToolCallCount !== 'number' || Number.isNaN(session.negRunToolCallCount)) {
    session.negRunToolCallCount = 0;
  }
}

/** Reset per-negotiation spend counters (session-wide spend is unchanged). */
export function resetNegotiationSpend(session) {
  ensureNegSpend(session);
  session.negRunSpentCents = 0;
  session.negRunToolCallCount = 0;
  session.negRunCountedKeys = [];
  session.negRunSpendLog = [];
  session.negRunActive = true;
}

/** @param {import('express-session').Session & Record<string, unknown>} session */
export function endNegotiationSpend(session) {
  session.negRunActive = false;
}

/** @param {import('express-session').Session & Record<string, unknown>} session */
export function getNegotiationSpendSummary(session) {
  ensureNegSpend(session);
  const log = Array.isArray(session.negRunSpendLog) ? session.negRunSpendLog : [];
  return {
    spentCents: session.negRunSpentCents,
    toolCallCount: session.negRunToolCallCount,
    perToolCostCents: mppToolCostCents(),
    toolsUsed: [...new Set(log.map((r) => r.toolName).filter(Boolean))],
    perToolSpend: log.map((r) => ({
      tool: r.toolName,
      amount_usd: Math.round(r.amountCents) / 100,
    })),
  };
}

/**
 * @param {import('express-session').Session & Record<string, unknown>} session
 */
export function getMppSpendSummary(session) {
  ensureMppSpend(session);
  return {
    spentCents: session.mppSpentCents,
    toolCallCount: session.mppToolCallCount,
    recent: session.mppSpendLog.slice(0, 20),
    perToolCostCents: mppToolCostCents(),
  };
}

/**
 * @param {import('express-session').Session & Record<string, unknown>} session
 * @param {string} dedupeKey
 * @param {number} cost
 * @param {string} [toolName]
 */
function recordNegToolSpend(session, dedupeKey, cost, toolName) {
  if (!session.negRunActive) return;
  ensureNegSpend(session);
  if (!Array.isArray(session.negRunCountedKeys)) session.negRunCountedKeys = [];
  if (session.negRunCountedKeys.includes(dedupeKey)) return;
  session.negRunCountedKeys.push(dedupeKey);
  session.negRunSpentCents += cost;
  session.negRunToolCallCount += 1;
  if (toolName) {
    if (!Array.isArray(session.negRunSpendLog)) session.negRunSpendLog = [];
    session.negRunSpendLog.push({
      toolName,
      amountCents: cost,
      at: new Date().toISOString(),
    });
  }
}

/**
 * Record a successful MPP tool call in the session spend tally.
 * @param {import('express-session').Session & Record<string, unknown>} session
 * @param {string} toolName
 * @param {string | null | undefined} paymentReceiptHeader
 * @param {number} [costCentsOverride] per-route cost from manifest URL pricing
 */
export function recordMppToolSpend(session, toolName, paymentReceiptHeader, costCentsOverride) {
  const cost =
    typeof costCentsOverride === 'number' && costCentsOverride > 0
      ? Math.round(costCentsOverride)
      : mppToolCostCents();
  ensureMppSpend(session);
  const receipt = typeof paymentReceiptHeader === 'string' ? paymentReceiptHeader.trim() : '';
  const dedupeKey = receipt ? `mpp-receipt:${receipt.slice(0, 120)}` : `mpp-tool:${toolName}:${Date.now()}`;
  if (session.mppSpendLog.some((row) => row.dedupeKey === dedupeKey)) {
    recordNegToolSpend(session, dedupeKey, cost, toolName);
    return null;
  }

  session.mppSpentCents += cost;
  session.mppToolCallCount += 1;
  recordNegToolSpend(session, dedupeKey, cost, toolName);
  const row = {
    id: `ms_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    toolName,
    amountCents: cost,
    at: new Date().toISOString(),
    dedupeKey,
  };
  session.mppSpendLog.unshift(row);
  if (session.mppSpendLog.length > MAX_SPEND_LOG) session.mppSpendLog.length = MAX_SPEND_LOG;
  return row;
}

/**
 * @param {import('express-session').Session & Record<string, unknown>} session
 */
export function getWalletSummary(session) {
  const pm = session.walletPaymentMethodId;
  const cur = (process.env.MPP_SPT_CURRENCY || 'usd').toLowerCase();
  const spend = getMppSpendSummary(session);
  const base = {
    currency: cur,
    ...spend,
  };
  if (!pm) {
    return {
      ...base,
      ready: false,
      paymentMethodId: null,
    };
  }
  return {
    ...base,
    ready: true,
    brand: session.walletPmBrand || null,
    last4: session.walletPmLast4 || null,
    paymentMethodId: pm,
  };
}

/**
 * Payment method status — refreshes card metadata from Stripe when possible.
 * @param {import('express-session').Session & Record<string, unknown>} session
 */
export async function getWalletStatusForApi(session) {
  const summary = getWalletSummary(session);
  const pm = session.walletPaymentMethodId;
  const stripe = getStripe();
  if (stripe && pm && typeof pm === 'string') {
    try {
      const live = await stripe.paymentMethods.retrieve(pm);
      session.walletPmBrand = live.card?.brand || live.type || null;
      session.walletPmLast4 = live.card?.last4 || null;
      if (summary.ready) {
        summary.brand = session.walletPmBrand;
        summary.last4 = session.walletPmLast4;
      }
    } catch {
      /* keep session-cached card metadata */
    }
  }
  return summary;
}

/**
 * @param {import('express-session').Session & Record<string, unknown>} session
 */
export async function ensureStripeCustomer(session) {
  const stripe = getStripe();
  if (!stripe) throw new Error('STRIPE_SECRET_KEY is not set');
  if (session.walletCustomerId) return /** @type {string} */ (session.walletCustomerId);
  const c = await stripe.customers.create({});
  session.walletCustomerId = c.id;
  return c.id;
}

/**
 * @param {import('express-session').Session & Record<string, unknown>} session
 */
export async function createSetupIntentForSession(session) {
  const stripe = getStripe();
  if (!stripe) throw new Error('STRIPE_SECRET_KEY is not set');
  const customerId = await ensureStripeCustomer(session);
  const si = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
    usage: 'off_session',
  });
  return { clientSecret: si.client_secret, setupIntentId: si.id, customerId };
}

/**
 * @param {import('express-session').Session & Record<string, unknown>} session
 * @param {string} setupIntentId
 */
export async function confirmSetupIntentAndSave(session, setupIntentId) {
  const stripe = getStripe();
  if (!stripe) throw new Error('STRIPE_SECRET_KEY is not set');
  const si = await stripe.setupIntents.retrieve(setupIntentId);
  if (si.status !== 'succeeded') {
    throw new Error(`SetupIntent not succeeded (status=${si.status})`);
  }
  const pmRef = si.payment_method;
  const pmId = typeof pmRef === 'string' ? pmRef : pmRef?.id;
  if (!pmId) throw new Error('SetupIntent has no payment_method');

  const pm = await stripe.paymentMethods.retrieve(pmId);
  session.walletPaymentMethodId = pmId;
  session.walletPmBrand = pm.card?.brand || pm.type || null;
  session.walletPmLast4 = pm.card?.last4 || null;
  return getWalletSummary(session);
}

/**
 * @param {import('express-session').Session & Record<string, unknown>} session
 */
export function clearWalletSession(session) {
  delete session.walletCustomerId;
  delete session.walletPaymentMethodId;
  delete session.walletPmBrand;
  delete session.walletPmLast4;
}

function stripeErrorMessage(err) {
  if (!err || typeof err !== 'object') return String(err);
  const raw = /** @type {{ raw?: { error?: { message?: string } } }} */ (err).raw;
  const fromRaw = raw?.error?.message;
  if (typeof fromRaw === 'string' && fromRaw.trim()) return fromRaw.trim();
  if ('message' in err && typeof err.message === 'string') return err.message;
  return String(err);
}

function amountStringToMaxCents(amount, decimals = 2) {
  const n = parseFloat(String(amount));
  if (!Number.isFinite(n) || n <= 0) {
    return Math.max(1, parseInt(process.env.MPP_SPT_DEFAULT_MAX_AMOUNT_CENTS || '500000', 10) || 500000);
  }
  const d = typeof decimals === 'number' && decimals >= 0 ? decimals : 2;
  return Math.max(1, Math.round(n * 10 ** d));
}

/**
 * Mint SPT scoped to an MPP stripe/charge challenge (networkId + amount from 402).
 * @param {import('express-session').Session & Record<string, unknown>} session
 * @param {{ networkId?: string, amount?: string, currency?: string, decimals?: number, expiresAt?: number, metadata?: Record<string, string>, paymentMethod?: string }} challenge
 */
export async function mintSharedPaymentTokenForMppChallenge(session, challenge = {}) {
  const networkId =
    (challenge.networkId || '').trim() ||
    mppSellerProfile() ||
    (process.env.STRIPE_PROFILE_ID || '').trim();
  const maxAmount = amountStringToMaxCents(challenge.amount, challenge.decimals);
  const currency = (challenge.currency || process.env.MPP_SPT_CURRENCY || 'usd').toLowerCase();
  const ttl = Math.max(60, parseInt(process.env.MPP_SPT_TTL_SECONDS || '3600', 10) || 3600);
  const expiresAt =
    typeof challenge.expiresAt === 'number' && challenge.expiresAt > Math.floor(Date.now() / 1000)
      ? challenge.expiresAt
      : Math.floor(Date.now() / 1000) + ttl;

  return mintSharedPaymentTokenCore(session, {
    maxAmountCents: maxAmount,
    currency,
    expiresAt,
    sellerProfile: networkId,
    paymentMethodOverride: challenge.paymentMethod,
  });
}

/**
 * @param {import('express-session').Session & Record<string, unknown>} session
 * @param {{ maxAmountCents: number, currency: string, expiresAt: number, sellerProfile?: string, paymentMethodOverride?: string }} opts
 */
async function mintSharedPaymentTokenCore(session, opts) {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error('STRIPE_SECRET_KEY is not set — cannot mint SPT for paid tools.');
  }
  const pm =
    (typeof opts.paymentMethodOverride === 'string' && opts.paymentMethodOverride) ||
    session.walletPaymentMethodId;
  if (!pm || typeof pm !== 'string') {
    throw new Error(
      'No saved payment method in this session — click **Add payment method** in the lab header, save a card, then retry.'
    );
  }

  const rawOpts = rawRequestOptions();
  /** @type {Record<string, string>} */
  const usageLimits = {
    'usage_limits[currency]': opts.currency,
    'usage_limits[max_amount]': String(opts.maxAmountCents),
    'usage_limits[expires_at]': String(opts.expiresAt),
  };

  const mode = walletSptMintMode();
  let id;
  try {
    if (mode === 'test_helper') {
      const granted = await stripe.rawRequest(
        'POST',
        '/v1/test_helpers/shared_payment/granted_tokens',
        { payment_method: pm, ...usageLimits },
        Object.keys(rawOpts).length ? rawOpts : undefined
      );
      id = granted?.id;
    } else {
      const profile = (opts.sellerProfile || mppSellerProfile() || '').trim();
      if (!profile) {
        throw new Error(
          'Issued-token mint needs networkId from MPP challenge or MPP_SELLER_NETWORK_BUSINESS_PROFILE / STRIPE_PROFILE_ID.'
        );
      }
      const issued = await stripe.rawRequest(
        'POST',
        '/v1/shared_payment/issued_tokens',
        {
          payment_method: pm,
          'seller_details[network_business_profile]': profile,
          ...usageLimits,
        },
        Object.keys(rawOpts).length ? rawOpts : undefined
      );
      id = issued?.id;
    }
  } catch (e) {
    const msg = stripeErrorMessage(e);
    if (mode === 'issued') {
      throw new Error(
        `${msg} — Set STRIPE_PROFILE_ID / MPP_SELLER_NETWORK_BUSINESS_PROFILE for this Stripe account, or MPP_SPT_MINT_MODE=test_helper.`
      );
    }
    throw new Error(`${msg} — Check STRIPE_SECRET_KEY and STRIPE_API_VERSION for SPT APIs.`);
  }

  if (typeof id === 'string' && id.startsWith('spt_')) {
    return id;
  }
  throw new Error('Stripe did not return an spt_ token id');
}

/**
 * Mint a new SPT for legacy mpp_spt header gate (pre-MPP property-service).
 * @param {import('express-session').Session & Record<string, unknown>} session
 */
export async function mintSharedPaymentTokenForPropertyApi(session) {
  const maxAmount = Math.max(
    1,
    parseInt(process.env.MPP_SPT_DEFAULT_MAX_AMOUNT_CENTS || '500000', 10) || 500000
  );
  const ttl = Math.max(60, parseInt(process.env.MPP_SPT_TTL_SECONDS || '3600', 10) || 3600);
  const currency = (process.env.MPP_SPT_CURRENCY || 'usd').toLowerCase();
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;

  return mintSharedPaymentTokenCore(session, {
    maxAmountCents: maxAmount,
    currency,
    expiresAt,
    sellerProfile: mppSellerProfile(),
  });
}

/**
 * @param {import('express').Request} req
 */
export function createMintSptBinder(req) {
  return async () => mintSharedPaymentTokenForPropertyApi(req.session);
}

/**
 * @param {import('express').Request} req
 */
export function createMppInvokeBinder(req) {
  return {
    session: req.session,
    mintSpt: async () => mintSharedPaymentTokenForPropertyApi(req.session),
  };
}
