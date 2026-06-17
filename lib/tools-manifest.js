/**
 * Tools from data/tools.manifest.json — HTTP execution only.
 * Paid tools (`mpp` / `mpp_spt`) use MPP client fetch (402 → pay → retry).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runWorkshopToolCall } from './workshop-tool-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESERVED = new Set(
  (process.env.RESERVED_TOOL_NAMES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

let cache = null;

function defaultManifestPath() {
  return path.join(__dirname, '..', 'data', 'tools.manifest.json');
}

/**
 * @param {{ quiet?: boolean }} [opts]
 */
export function loadToolsManifest(opts = {}) {
  const quiet = opts.quiet === true;
  const filePath = (process.env.TOOLS_MANIFEST_PATH || '').trim() || defaultManifestPath();
  const warnings = [];
  const errors = [];

  if (!fs.existsSync(filePath)) {
    warnings.push(`manifest not found at ${filePath} — model runs with no tools`);
    return { path: filePath, tools: [], byName: new Map(), openaiTools: [], warnings, errors };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    errors.push(`failed to read/parse manifest: ${e.message}`);
    return { path: filePath, tools: [], byName: new Map(), openaiTools: [], warnings, errors };
  }

  const list = Array.isArray(data?.tools) ? data.tools : [];
  const tools = [];
  const byName = new Map();

  for (const t of list) {
    if (!t || typeof t !== 'object') {
      warnings.push('skipped non-object tool entry');
      continue;
    }
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    if (!name) {
      warnings.push('skipped tool without name');
      continue;
    }
    if (RESERVED.has(name)) {
      warnings.push(`skipped "${name}" — reserved name`);
      continue;
    }
    if (byName.has(name)) {
      warnings.push(`skipped duplicate "${name}"`);
      continue;
    }
    if (typeof t.description !== 'string' || !t.description.trim()) {
      warnings.push(`skipped "${name}" — missing description`);
      continue;
    }
    if (!t.parameters || typeof t.parameters !== 'object') {
      warnings.push(`skipped "${name}" — parameters must be a JSON Schema object`);
      continue;
    }
    if (!t.http || typeof t.http !== 'object' || typeof t.http.url !== 'string' || !t.http.url.trim()) {
      warnings.push(`skipped "${name}" — missing http.url`);
      continue;
    }

    tools.push(t);
    byName.set(name, t);
  }

  const openaiTools = tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  if (tools.length > 0 && !quiet) {
    console.log(`[manifest] ${tools.length} tool(s) from ${filePath}`);
  }
  if (!quiet) {
    for (const w of warnings) console.warn(`[manifest] ${w}`);
    for (const e of errors) console.error(`[manifest] ${e}`);
  }

  return { path: filePath, tools, byName, openaiTools, warnings, errors };
}

export function getManifestToolsState() {
  if (!cache) cache = loadToolsManifest();
  return cache;
}

export function reloadManifestTools() {
  cache = null;
}

function resolveHeaderValue(spec) {
  if (typeof spec === 'string') return spec;
  if (spec && typeof spec === 'object' && typeof spec.env === 'string') {
    return process.env[spec.env] || '';
  }
  return '';
}

/**
 * @param {any} toolDef
 */
function toolUsesMpp(toolDef) {
  return toolDef.mpp === true || toolDef.mpp_spt === true;
}

/**
 * @param {any} toolDef
 */
function toolUsesLegacySptHeader(toolDef) {
  return toolDef.mpp_legacy_header === true;
}

/**
 * @param {any} toolDef
 * @param {Record<string, unknown>} args
 * @param {{ session?: import('express-session').Session, mintSpt?: () => Promise<string|null> }} [invokeOpts]
 */
export async function invokeManifestHttpTool(toolDef, args, invokeOpts = {}) {
  /** Apply env-sourced headers before central runner executes. */
  const normalized = {
    ...toolDef,
    http: {
      ...(toolDef?.http || {}),
      headers: Object.fromEntries(
        Object.entries(toolDef?.http?.headers || {})
          .map(([key, spec]) => [key, resolveHeaderValue(spec)])
          .filter(([, val]) => !!val)
      ),
    },
  };

  const result = await runWorkshopToolCall(normalized, args, invokeOpts);

  // Keep spend accounting hook here so attendees can focus on payment flow wiring.
  if (result?.success && result?.mpp && invokeOpts?.session) {
    try {
      const { recordMppToolSpend } = await import('./agent-wallet.js');
      const { fiatCentsForTool } = await import('./mpp-tool-pricing.js');
      recordMppToolSpend(invokeOpts.session, toolDef.name, result.payment_receipt, fiatCentsForTool(toolDef));
    } catch {
      // Non-fatal for workshop.
    }
  }

  return result;
}
