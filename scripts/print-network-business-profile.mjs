#!/usr/bin/env node
/**
 * Print the Stripe **network business profile** id for the account whose secret key you pass.
 * Use the **same** Stripe account as **property-service** (seller) when setting `MPP_SELLER_NETWORK_BUSINESS_PROFILE`
 * on the buyer agent — unless you intentionally use a different seller account.
 *
 * Usage (repo root, after .env has a secret key):
 *   npm run wallet:print-profile --prefix agent
 *
 * Keys (first match wins):
 *   STRIPE_PROFILE_LOOKUP_SECRET_KEY — seller sk (recommended if agent ≠ seller)
 *   STRIPE_SECRET_KEY — fallback
 *
 * Requires a preview `Stripe-Version` for the v2 Profiles API unless your account default works.
 */
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentDir = join(__dirname, '..');
dotenv.config({ path: join(agentDir, '..', '.env') });
dotenv.config({ path: join(agentDir, '.env'), override: true });

const sk =
  (process.env.STRIPE_PROFILE_LOOKUP_SECRET_KEY || '').trim() ||
  (process.env.STRIPE_SECRET_KEY || '').trim();
const apiVersion =
  (process.env.STRIPE_API_VERSION || '').trim() || '2026-04-22.preview';

const paths = ['/v2/network/business_profiles/me'];

async function tryFetch(path, authHeader) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      'Stripe-Version': apiVersion,
    },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { res, json };
}

async function main() {
  if (!sk) {
    console.error('Set STRIPE_PROFILE_LOOKUP_SECRET_KEY or STRIPE_SECRET_KEY in .env (seller account sk_test_…).');
    process.exit(1);
  }

  const bearer = `Bearer ${sk}`;
  const basic = `Basic ${Buffer.from(`${sk}:`, 'utf8').toString('base64')}`;

  for (const path of paths) {
    for (const auth of [bearer, basic]) {
      const { res, json } = await tryFetch(path, auth);
      if (res.ok && json && typeof json.id === 'string' && json.id.startsWith('profile_')) {
        console.log('');
        console.log('Set in repo root .env:');
        console.log(`MPP_SELLER_NETWORK_BUSINESS_PROFILE=${json.id}`);
        console.log('');
        console.log('(Stripe object:', json.object || 'n/a', '| auth:', auth.startsWith('Bearer') ? 'Bearer' : 'Basic', ')');
        return;
      }
    }
  }

  const last = await tryFetch(paths[0], bearer);
  console.error('Could not retrieve network business profile.');
  console.error('HTTP', last.res.status, paths[0]);
  console.error(JSON.stringify(last.json, null, 2));
  console.error('');
  console.error('Typical fixes:');
  console.error('  1. Use the secret key for the **seller** Stripe account (same as property-service Lambda).');
  console.error('  2. Complete Stripe **Agentic commerce** / business profile onboarding in that Dashboard:');
  console.error('     https://dashboard.stripe.com/settings/connect/agentic-commerce');
  console.error('     (or Settings → Payments → Agentic commerce — UI names change).');
  console.error('  3. Set STRIPE_API_VERSION to the preview string Stripe documents for v2 Business Profiles (default in script: 2026-04-22.preview).');
  console.error('  4. Until you have a profile id, use property-service PropertyGateMode=mpp_stub and skip wallet SPT.');
  process.exit(1);
}

main();
