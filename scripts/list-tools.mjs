#!/usr/bin/env node
/**
 * List manifest HTTP tools (same source as the running agent).
 *
 * Usage (from repo root or agent/):
 *   node agent/scripts/list-tools.mjs
 *   node scripts/list-tools.mjs          # from agent/
 *
 * Options:
 *   --json          machine-readable (names, descriptions, http summary)
 *   --manifest PATH use this manifest file (overrides TOOLS_MANIFEST_PATH for this run)
 */
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadToolsManifest } from '../lib/tools-manifest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentDir = join(__dirname, '..');

// Match agent/server.js load order: repo root .env, then agent/.env overrides
dotenv.config({ path: join(agentDir, '..', '.env') });
dotenv.config({ path: join(agentDir, '.env'), override: true });

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const mi = args.indexOf('--manifest');
if (mi !== -1 && args[mi + 1]) {
  process.env.TOOLS_MANIFEST_PATH = args[mi + 1];
}

const st = loadToolsManifest({ quiet: true });

function headerSummary(h) {
  if (!h || typeof h !== 'object') return '';
  return Object.entries(h)
    .map(([k, v]) => {
      if (typeof v === 'string') return `${k}: literal`;
      if (v && typeof v === 'object' && typeof v.env === 'string') return `${k}: env:${v.env}`;
      return `${k}: ?`;
    })
    .join('; ');
}

if (wantJson) {
  const payload = {
    manifestPath: st.path,
    warnings: st.warnings,
    errors: st.errors,
    tools: st.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      http: {
        method: (t.http?.method || 'POST').toString().toUpperCase(),
        url: t.http?.url || '',
        headers: headerSummary(t.http?.headers),
      },
    })),
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(st.errors.length ? 1 : 0);
}

console.log(`Manifest: ${st.path}`);
if (st.errors.length) {
  for (const e of st.errors) console.error(`Error: ${e}`);
}
for (const w of st.warnings) console.warn(`Warning: ${w}`);
console.log(`Tools: ${st.tools.length}\n`);

for (const t of st.tools) {
  const method = (t.http?.method || 'POST').toString().toUpperCase();
  const url = (t.http?.url || '').trim();
  const hdr = headerSummary(t.http?.headers);
  console.log(`— ${t.name}`);
  console.log(`  ${method} ${url}`);
  if (hdr) console.log(`  headers: ${hdr}`);
  const desc = (t.description || '').trim().replace(/\s+/g, ' ');
  const line = desc.length > 200 ? `${desc.slice(0, 197)}…` : desc;
  console.log(`  ${line}`);
  console.log('');
}

process.exit(st.errors.length ? 1 : 0);
