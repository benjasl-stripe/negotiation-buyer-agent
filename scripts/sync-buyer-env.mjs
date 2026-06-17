#!/usr/bin/env node
/**
 * Set non-secret buyer-agent defaults in repo root `.env`.
 * Does not overwrite OPENAI_API_KEY, STRIPE_* keys, or SESSION_SECRET unless --force-all.
 */
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');

const SELLER_PROFILE = 'profile_test_61UpRd5aUNA6FVOF8A6UpRd46bE926oQ5kIpS7URcRc8';

const DEFAULTS = {
  WORKSHOP_SECRET: 'sessions',
  SELLER_SERVICE_URL: 'https://xaawagr36f.execute-api.us-west-2.amazonaws.com',
  STRIPE_PROFILE_ID: SELLER_PROFILE,
  MPP_SPT_MINT_MODE: 'test_helper',
  STRIPE_API_VERSION: '2026-05-27.preview',
  OPENAI_MODEL: 'gpt-4o-mini',
  AGENT_PORT: '3000',
};

const REMOVE_KEYS = new Set([
  'PROPERTY_GATE_MODE',
  'MPP_SECRET_KEY',
  'PROPERTY_SERVICE_STRIPE_SECRET_KEY',
  'PROPERTY_SERVICE_MPP_SECRET_KEY',
]);

function parseEnv(text) {
  const lines = text.split('\n');
  const map = new Map();
  const order = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) {
      if (!map.has(m[1])) order.push(m[1]);
      map.set(m[1], m[2]);
    }
  }
  return { lines, map, order };
}

function serializeEnv(originalLines, map, order, appendedKeys) {
  const seen = new Set();
  const out = [];
  for (const line of originalLines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (m && map.has(m[1])) {
      if (REMOVE_KEYS.has(m[1])) continue;
      out.push(`${m[1]}=${map.get(m[1])}`);
      seen.add(m[1]);
    } else {
      out.push(line);
    }
  }
  for (const key of [...order, ...appendedKeys]) {
    if (seen.has(key) || REMOVE_KEYS.has(key) || !map.has(key)) continue;
    out.push(`${key}=${map.get(key)}`);
    seen.add(key);
  }
  return out.join('\n').replace(/\n?$/, '\n');
}

async function fetchAwsUrls() {
  try {
    const { execSync } = await import('child_process');
    const region = 'us-west-2';

    const aiProxy = execSync(
      "aws cloudformation describe-stacks --stack-name ai-chat-proxy --region us-west-2 --query \"Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue | [0]\" --output text",
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (aiProxy && aiProxy !== 'None') DEFAULTS.LAMBDA_ENDPOINT = aiProxy;

    const seller = execSync(
      "aws cloudformation describe-stacks --stack-name Seller-agent --region us-west-2 --query \"Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue | [0]\" --output text",
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (seller && seller !== 'None') DEFAULTS.SELLER_SERVICE_URL = seller;

    for (const stackName of ['negotiaon-agent', 'negotiation-judge-service', 'negotiation-judge']) {
      try {
        const judgeUrl = execSync(
          `aws cloudformation describe-stacks --stack-name ${stackName} --region ${region} --query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue | [0]" --output text`,
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim();
        if (judgeUrl && judgeUrl !== 'None') {
          DEFAULTS.JUDGE_SERVICE_URL = judgeUrl.replace(/\/$/, '');
          break;
        }
      } catch {
        /* try next stack name */
      }
    }

    if (DEFAULTS.JUDGE_SERVICE_URL) {
      try {
        const fnName = execSync(
          `aws cloudformation describe-stack-resources --stack-name negotiaon-agent --region ${region} --query "StackResources[?ResourceType=='AWS::Lambda::Function'].PhysicalResourceId | [0]" --output text`,
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim();
        if (fnName && fnName !== 'None') {
          const key = execSync(
            `aws lambda get-function-configuration --function-name ${fnName} --region ${region} --query "Environment.Variables.JUDGE_SERVICE_KEY" --output text`,
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
          ).trim();
          if (key && key !== 'None') DEFAULTS.JUDGE_SERVICE_KEY = key;
        }
      } catch {
        /* optional — buyer can set JUDGE_SERVICE_KEY manually */
      }
    }
  } catch {
    /* use baked-in defaults */
  }
}

await fetchAwsUrls();

let text = '';
if (fs.existsSync(envPath)) text = fs.readFileSync(envPath, 'utf8');
else text = '# Buyer agent — see .env.example\n';

const { lines, map, order } = parseEnv(text);
const appended = [];

for (const key of REMOVE_KEYS) {
  if (map.delete(key)) console.log(`Removed seller-only key: ${key}`);
}

for (const [key, value] of Object.entries(DEFAULTS)) {
  const current = (map.get(key) || '').trim();
  if (key === 'LAMBDA_ENDPOINT') {
    const oldShared = /bnkl1g96p3\.execute-api/i.test(current);
    if (!current || oldShared) {
      map.set(key, value);
      if (!order.includes(key)) appended.push(key);
      console.log(oldShared ? `Updated ${key} (was shared ai-chat)` : `Set ${key}`);
    } else if (current !== value && value.includes('3ik2p1nj9a')) {
      console.log(`Keeping existing ${key} (${current})`);
    }
    continue;
  }
  if (key === 'MPP_SPT_MINT_MODE' && current === 'issued') {
    map.set(key, value);
    console.log(`Updated ${key}: issued → test_helper (buyer/seller use different Stripe accounts)`);
    continue;
  }
  if (!current) {
    map.set(key, value);
    if (!order.includes(key)) appended.push(key);
    console.log(`Set ${key}`);
  } else if (key === 'SELLER_SERVICE_URL' && current !== value) {
    console.log(`Keeping existing ${key} (${current})`);
  } else if (key === 'JUDGE_SERVICE_URL' && current !== value && value) {
    map.set(key, value);
    console.log(`Updated ${key}`);
  } else if (key === 'JUDGE_SERVICE_KEY' && value && !current) {
    map.set(key, value);
    if (!order.includes(key)) appended.push(key);
    console.log(`Set ${key} (from deployed judge Lambda)`);
  }
}

fs.writeFileSync(envPath, serializeEnv(lines, map, order, appended));
console.log(`\nUpdated ${envPath}`);
console.log('Next: set buyer STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY (no OPENAI_API_KEY needed with LAMBDA_ENDPOINT)');
console.log('Then: npm run buyer:check && npm run dev');
