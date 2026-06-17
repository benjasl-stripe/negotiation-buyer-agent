/**
 * MPP client for manifest HTTP tools — handles 402 challenges automatically.
 * Uses Stripe SPT from saved payment method.
 */
import { Mppx, stripe as mppStripeClient } from 'mppx/client';
import {
  mintSharedPaymentTokenForMppChallenge,
  mintSharedPaymentTokenForPropertyApi,
  walletSptMintMode,
} from './agent-wallet.js';

/** @type {ReturnType<typeof buildAgentMppClient> | null} */
let cachedClient = null;
/** @type {import('express-session').Session | null} */
let cachedSession = null;

/**
 * @param {import('express-session').Session & Record<string, unknown>} session
 */
export function buildAgentMppClient(session) {
  /** @type {import('mppx/client').Methods} */
  const methods = [];

  methods.push(
    mppStripeClient.charge({
      createToken: async (params) => {
        const networkId = params.networkId || (process.env.STRIPE_PROFILE_ID || '').trim();
        return mintSharedPaymentTokenForMppChallenge(session, {
          networkId,
          amount: params.amount,
          currency: params.currency,
          decimals: params.decimals,
          expiresAt: params.expiresAt,
          metadata: params.metadata,
          paymentMethod: params.paymentMethod,
        });
      },
    })
  );

  return Mppx.create({
    polyfill: false,
    methods,
  });
}

/**
 * @param {import('express-session').Session & Record<string, unknown>} session
 */
export function getAgentMppClient(session) {
  if (cachedClient && cachedSession === session) return cachedClient;
  cachedSession = session;
  cachedClient = buildAgentMppClient(session);
  return cachedClient;
}

/**
 * Fetch a URL with automatic MPP 402 handling (Stripe SPT).
 * @param {import('express-session').Session & Record<string, unknown>} session
 * @param {string} url
 * @param {RequestInit & { context?: { paymentMethod?: string } }} [init]
 */
export async function fetchWithMpp(session, url, init = {}) {
  const client = getAgentMppClient(session);
  const pm =
    typeof session.walletPaymentMethodId === 'string' ? session.walletPaymentMethodId.trim() : '';
  const { context: initContext, ...rest } = init;
  /** @type {RequestInit & { context?: { paymentMethod?: string } }} */
  const merged = { ...rest };
  if (pm) {
    merged.context = { ...(initContext || {}), paymentMethod: pm };
  } else if (initContext) {
    merged.context = initContext;
  }
  return client.fetch(url, merged);
}

/**
 * Legacy path: mint SPT and send X-Shared-Payment-Token (pre-MPP gate).
 * @param {import('express-session').Session & Record<string, unknown>} session
 */
export async function mintLegacySptHeader(session) {
  return mintSharedPaymentTokenForPropertyApi(session);
}

export { walletSptMintMode };
