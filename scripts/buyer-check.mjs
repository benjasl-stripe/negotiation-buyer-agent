#!/usr/bin/env node
/**
 * Validate buyer-agent .env (repo root) — does not print secret values.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadToolsManifest } from '../lib/tools-manifest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
dotenv.config({ path: join(repoRoot, '.env') });
dotenv.config({ path: join(repoRoot, '.env.local'), override: true });

const errors = [];
const warnings = [];

function set(name) {
  return !!(process.env[name] || '').trim();
}

const lambdaEndpoint = (process.env.LAMBDA_ENDPOINT || '').trim();
const workshopSecret = (process.env.WORKSHOP_SECRET || '').trim();
const openAiKey = (process.env.OPENAI_API_KEY || '').trim();

if (!lambdaEndpoint && !openAiKey) {
  errors.push('Set LAMBDA_ENDPOINT + WORKSHOP_SECRET (workshop proxy) or OPENAI_API_KEY (direct)');
} else if (lambdaEndpoint && !workshopSecret) {
  errors.push('WORKSHOP_SECRET is required when LAMBDA_ENDPOINT is set');
} else if (!lambdaEndpoint && openAiKey && (openAiKey === 'sk-...' || openAiKey.length < 20)) {
  errors.push('OPENAI_API_KEY looks like a placeholder — use LAMBDA_ENDPOINT or a real key');
}
if (!set('STRIPE_SECRET_KEY')) errors.push('STRIPE_SECRET_KEY (buyer account) is not set');
if (!set('STRIPE_PUBLISHABLE_KEY')) errors.push('STRIPE_PUBLISHABLE_KEY (buyer account) is not set');

const profile = (process.env.STRIPE_PROFILE_ID || '').trim();
const mintMode = (process.env.MPP_SPT_MINT_MODE || '').trim().toLowerCase();
const sk = (process.env.STRIPE_SECRET_KEY || '').trim();

if (mintMode === 'issued' || (!mintMode && sk.startsWith('sk_live_'))) {
  if (!profile) {
    errors.push('STRIPE_PROFILE_ID is required when MPP_SPT_MINT_MODE=issued');
  } else if (!profile.startsWith('profile_')) {
    warnings.push('STRIPE_PROFILE_ID should start with profile_');
  }
  if (mintMode === 'issued' && sk.startsWith('sk_test_')) {
    warnings.push(
      'MPP_SPT_MINT_MODE=issued with sk_test_ often fails when buyer and seller use different Stripe accounts — use test_helper for this workshop'
    );
  }
}

if (!set('SELLER_SERVICE_URL')) {
  warnings.push('SELLER_SERVICE_URL is not set — Run vs seller will not work');
} else if (!set('SELLER_SERVICE_KEY')) {
  const sellerUrl = (process.env.SELLER_SERVICE_URL || '').trim().replace(/\/$/, '');
  try {
    const r = await fetch(`${sellerUrl}/api/seller/opening`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyerGoal: 'auth probe' }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && /X-Seller-Service-Key/i.test(String(j.error || ''))) {
      errors.push(
        'SELLER_SERVICE_KEY is required — your deployed seller requires X-Seller-Service-Key (copy SellerServiceKey from seller deploy, or run: aws lambda get-function-configuration --function-name <SellerFunction> --query Environment.Variables.SELLER_SERVICE_KEY)'
      );
    }
  } catch {
    warnings.push('Could not probe seller-service auth — set SELLER_SERVICE_KEY if negotiation returns 401');
  }
}

if ((process.env.STRIPE_SECRET_KEY || '').includes('SELLER')) {
  warnings.push('STRIPE_SECRET_KEY looks like a placeholder — use the BUYER account key');
}

const st = loadToolsManifest({ quiet: true });
const mppTools = st.tools.filter((t) => t.mpp || t.mpp_spt);
if (!mppTools.length) {
  warnings.push('No tools with mpp:true in manifest');
} else {
  const local = mppTools.some((t) => /localhost|127\.0\.0\.1|:8787/.test(t.http?.url || ''));
  if (local) warnings.push('Manifest still has localhost property URLs — point at AWS HttpApiUrl');
}

const propertyUrl = mppTools[0]?.http?.url || '';
if (propertyUrl.includes('u8dawxdoyh.execute-api')) {
  console.log('Manifest property API: AWS (u8dawxdoyh…) ✓');
}
if (/bnkl1g96p3\.execute-api/i.test(lambdaEndpoint)) {
  warnings.push(
    'LAMBDA_ENDPOINT points at shared workshop ai-chat (ACP tools) — use ai-chat-proxy stack URL instead'
  );
}
if (/3ik2p1nj9a\.execute-api/i.test(lambdaEndpoint)) {
  console.log('Lambda proxy: ai-chat-proxy (3ik2p1nj9a…) ✓');
}

console.log('Buyer agent configuration check\n');
console.log('  OpenAI mode:', lambdaEndpoint ? 'lambda proxy' : openAiKey ? 'direct' : 'MISSING');
console.log('  Lambda URL:', lambdaEndpoint || '(not set)');
console.log('  Workshop secret:', workshopSecret ? '(set)' : '(not set)');
console.log('  Seller URL:', (process.env.SELLER_SERVICE_URL || '').trim() || '(not set)');
console.log('  Seller key:', set('SELLER_SERVICE_KEY') ? '(set)' : '(not set — OK if seller has no auth)');
console.log('  Judge URL:', (process.env.JUDGE_SERVICE_URL || '').trim() || '(not set)');
console.log('  Judge key:', set('JUDGE_SERVICE_KEY') ? '(set)' : '(not set)');

const judgeUrl = (process.env.JUDGE_SERVICE_URL || '').trim().replace(/\/$/, '');
if (judgeUrl) {
  try {
    const r = await fetch(`${judgeUrl}/api/health`);
    const j = await r.json().catch(() => ({}));
    if (j.auth && /x-judge-service-key/i.test(String(j.auth)) && !set('JUDGE_SERVICE_KEY')) {
      errors.push(
        'JUDGE_SERVICE_KEY is required — deployed judge requires X-Judge-Service-Key (run npm run buyer:sync-env or copy from judge Lambda env)'
      );
    } else if (judgeUrl && !j.ok) {
      warnings.push('Judge service health check failed — verify JUDGE_SERVICE_URL');
    } else if (j.ok) {
      console.log('  Judge health: OK ✓');
    }
  } catch {
    warnings.push('Could not reach judge service — check JUDGE_SERVICE_URL');
  }
} else {
  warnings.push('JUDGE_SERVICE_URL is not set — no auto-scoring after negotiation (run npm run buyer:sync-env)');
}
console.log('  Buyer Stripe:', set('STRIPE_SECRET_KEY') && set('STRIPE_PUBLISHABLE_KEY') ? 'configured' : 'incomplete');
console.log('  Seller profile ref:', profile ? `${profile.slice(0, 28)}…` : '(not set)');
console.log(
  '  SPT mint mode:',
  mintMode || (sk.startsWith('sk_test_') ? 'test_helper (default)' : 'issued (default)')
);
console.log('  MPP tools in manifest:', mppTools.length);

if (warnings.length) {
  console.log('\nWarnings:');
  for (const w of warnings) console.log(`  • ${w}`);
}
if (errors.length) {
  console.log('\nErrors:');
  for (const e of errors) console.log(`  • ${e}`);
  console.log('\nSee .env.buyer.example');
  process.exit(1);
}

console.log('\nOK — start the buyer agent: npm run dev');
