#!/usr/bin/env node
/**
 * Interactive .env setup for buyer agent.
 * Creates .env when missing and updates selected keys in place.
 */
import fs from 'fs';
import { randomBytes } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const envPath = join(repoRoot, '.env');
const envExamplePath = join(repoRoot, '.env.example');

const FIELDS = [
  {
    key: 'LAMBDA_ENDPOINT',
    label: 'Lambda endpoint (ai-chat-proxy URL, no trailing slash)',
    required: true,
    validate: (value) =>
      /^https:\/\/[a-z0-9-]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com(\/[A-Za-z0-9._~-]+)?$/i.test(
        value
      ),
    help: 'Example: https://3ik2p1nj9a.execute-api.us-west-2.amazonaws.com',
  },
  {
    key: 'WORKSHOP_SECRET',
    label: 'Workshop secret',
    required: true,
    defaultValue: 'sessions',
  },
  {
    key: 'STRIPE_SECRET_KEY',
    label: 'Buyer Stripe secret key',
    required: true,
    validate: (value) => /^sk_(test|live)_/.test(value),
    help: 'Must start with sk_test_ or sk_live_.',
  },
  {
    key: 'STRIPE_PUBLISHABLE_KEY',
    label: 'Buyer Stripe publishable key',
    required: true,
    validate: (value) => /^pk_(test|live)_/.test(value),
    help: 'Must start with pk_test_ or pk_live_.',
  },
  {
    key: 'SELLER_SERVICE_URL',
    label: 'Seller service URL (for Run vs seller)',
    required: false,
    validate: (value) => /^https?:\/\//i.test(value),
    help: 'Example: https://xaawagr36f.execute-api.us-west-2.amazonaws.com',
  },
  {
    key: 'SELLER_SERVICE_KEY',
    label: 'Seller service key (if seller requires auth)',
    required: false,
  },
  {
    key: 'SESSION_SECRET',
    label: 'Session secret',
    required: true,
    defaultFactory: () => randomBytes(24).toString('hex'),
  },
  {
    key: 'JUDGE_SERVICE_URL',
    label: 'Judge service URL (optional)',
    required: false,
    validate: (value) => /^https?:\/\//i.test(value),
    help: 'Example: https://<id>.execute-api.us-west-2.amazonaws.com',
  },
  {
    key: 'JUDGE_SERVICE_KEY',
    label: 'Judge service key (optional)',
    required: false,
  },
];

function parseEnv(text) {
  const lines = text.split('\n');
  const map = new Map();
  const order = [];
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (!map.has(key)) order.push(key);
    map.set(key, value);
  }
  return { lines, map, order };
}

function serializeEnv(originalLines, map, order, appendedKeys) {
  const seen = new Set();
  const out = [];
  for (const line of originalLines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match && map.has(match[1])) {
      out.push(`${match[1]}=${map.get(match[1])}`);
      seen.add(match[1]);
    } else {
      out.push(line);
    }
  }

  for (const key of [...order, ...appendedKeys]) {
    if (seen.has(key) || !map.has(key)) continue;
    out.push(`${key}=${map.get(key)}`);
    seen.add(key);
  }
  return out.join('\n').replace(/\n?$/, '\n');
}

function getSeedEnvText() {
  if (fs.existsSync(envPath)) return fs.readFileSync(envPath, 'utf8');
  if (fs.existsSync(envExamplePath)) return fs.readFileSync(envExamplePath, 'utf8');
  return '# Buyer agent environment\n';
}

async function askField(rl, field, currentRaw) {
  const current = (currentRaw || '').trim();
  const generatedDefault = field.defaultFactory ? field.defaultFactory() : '';
  const fallbackDefault = current || field.defaultValue || generatedDefault || '';

  while (true) {
    const promptBits = [field.label];
    if (fallbackDefault && !current) promptBits.push(`default: ${fallbackDefault}`);
    if (current) promptBits.push('press Enter to keep current value');
    if (!field.required && !current) promptBits.push('optional');

    const answer = (
      await rl.question(`- ${promptBits.join(' | ')}\n  ${field.key}=`)
    ).trim();

    const finalValue = answer || fallbackDefault;
    if (!finalValue) {
      if (field.required) {
        output.write(`  ${field.key} is required.\n`);
        if (field.help) output.write(`  ${field.help}\n`);
        continue;
      }
      return '';
    }

    if (field.validate && !field.validate(finalValue)) {
      output.write(`  Value for ${field.key} does not look valid.\n`);
      if (field.help) output.write(`  ${field.help}\n`);
      continue;
    }
    return finalValue;
  }
}

async function main() {
  const rl = readline.createInterface({ input, output });
  try {
    output.write('\nBuyer agent setup\n\n');
    output.write('This will create/update .env for local development.\n');
    output.write('Press Enter to keep current values when shown.\n\n');

    const sourceText = getSeedEnvText();
    const { lines, map, order } = parseEnv(sourceText);
    const appended = [];

    for (const field of FIELDS) {
      const next = await askField(rl, field, map.get(field.key));
      if (!next) continue;
      map.set(field.key, next);
      if (!order.includes(field.key)) appended.push(field.key);
    }

    if (!map.get('OPENAI_MODEL')) {
      map.set('OPENAI_MODEL', 'gpt-4o-mini');
      if (!order.includes('OPENAI_MODEL')) appended.push('OPENAI_MODEL');
    }
    if (!map.get('AGENT_PORT')) {
      map.set('AGENT_PORT', '3000');
      if (!order.includes('AGENT_PORT')) appended.push('AGENT_PORT');
    }

    const out = serializeEnv(lines, map, order, appended);
    fs.writeFileSync(envPath, out);

    output.write(`\nSaved ${envPath}\n`);
    output.write('Next steps:\n');
    output.write('  npm run buyer:check\n');
    output.write('  npm run dev\n');
    output.write('\nNote: property tool URLs are configured in data/tools.manifest.json.\n');
  } finally {
    rl.close();
  }
}

await main();
