#!/usr/bin/env node
/**
 * Discover hackathon tool options from catalog format (intentionally different
 * from runtime manifest format).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const catalogPath = join(rootDir, 'data', 'tools.catalog.json');

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

let catalog;
try {
  catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
} catch (e) {
  fail(`failed to read/parse ${catalogPath}: ${e instanceof Error ? e.message : String(e)}`);
}

if (!catalog || typeof catalog !== 'object') fail('catalog root must be an object');

const entries = Array.isArray(catalog.entries) ? catalog.entries : null;
if (!entries) fail('catalog must include entries[]');

console.log(`Catalog: ${catalogPath}`);
console.log(`Entries: ${entries.length}\n`);
console.log('Note: This is a discover-only format (not manifest-compatible).');
console.log('Create tools manually in data/tools.manifest.json.\n');

for (const row of entries) {
  if (!row || typeof row !== 'object') continue;
  const key = String(row.key || '').trim();
  const route = String(row.route || '').trim();
  if (!key || !route) continue;
  const label = String(row.label || key).trim();
  const when = String(row.when_to_use || '').trim();
  const paid = row.payment === 'free' ? 'free' : 'paid (MPP)';

  console.log(`— ${label}`);
  console.log(`  key: ${key}`);
  console.log(`  route: ${route}`);
  console.log(`  payment: ${paid}`);
  if (when) console.log(`  use when: ${when}`);
  console.log('');
}
