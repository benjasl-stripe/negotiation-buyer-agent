/**
 * Tools from data/tools.manifest.json — HTTP execution only.
 * Paid tools (`mpp` / `mpp_spt`) use MPP client fetch (402 → pay → retry).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { walletSptMintMode } from './agent-wallet.js';

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
  const http = toolDef.http;
  const method = (http.method || 'POST').toString().toUpperCase();
  const headers = {};
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  for (const [key, spec] of Object.entries(http.headers || {})) {
    const val = resolveHeaderValue(spec);
    if (val) headers[key] = val;
  }

  let url = http.url.trim();
  if (method === 'GET') {
    const u = new URL(url);
    for (const [k, v] of Object.entries(args || {})) {
      if (v != null && v !== '') u.searchParams.set(k, String(v));
    }
    url = u.toString();
  }

  const useMpp = toolUsesMpp(toolDef);
  const legacyHeader = toolUsesLegacySptHeader(toolDef);
  const session = invokeOpts.session;

  if (useMpp && !legacyHeader && session) {
    try {
      const { fetchWithMpp } = await import('./mpp-client.js');
      const init =
        method === 'GET'
          ? { method: 'GET', headers }
          : {
              method: method === 'POST' || method === 'PUT' || method === 'PATCH' ? method : 'POST',
              headers,
              body: JSON.stringify(args ?? {}),
            };
      const res = await fetchWithMpp(session, url, init);
      const text = await res.text();
      let bodyJson = null;
      try {
        bodyJson = text ? JSON.parse(text) : null;
      } catch {
        bodyJson = text;
      }

      if (!res.ok) {
        const detail =
          typeof bodyJson === 'object' && bodyJson && (bodyJson.detail || bodyJson.error)
            ? bodyJson.detail || bodyJson.error
            : res.statusText;
        return {
          success: false,
          http_status: res.status,
          error: detail,
          response_body: bodyJson,
          mpp: true,
        };
      }

      const paymentReceipt = res.headers.get('payment-receipt') || res.headers.get('Payment-Receipt');
      const { recordMppToolSpend } = await import('./agent-wallet.js');
      const { fiatCentsForTool } = await import('./mpp-tool-pricing.js');
      recordMppToolSpend(session, toolDef.name, paymentReceipt, fiatCentsForTool(toolDef));

      return {
        success: true,
        http_status: res.status,
        data: bodyJson,
        mpp: true,
        payment_receipt: paymentReceipt,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        http_status: 0,
        mpp: true,
      };
    }
  }

  if (useMpp && legacyHeader) {
    const mint = typeof invokeOpts.mintSpt === 'function' ? invokeOpts.mintSpt : null;
    if (mint) {
      try {
        const tok = await mint();
        if (tok) headers['X-Shared-Payment-Token'] = tok;
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e),
          http_status: 0,
        };
      }
    }
    if (!headers['X-Shared-Payment-Token']) {
      const mode = walletSptMintMode();
      const testHelper = mode === 'test_helper';
      const hint = testHelper
        ? 'Add a card via **Add payment method** in the lab header, or set PROPERTY_GATE_MODE=mpp on the property API for full MPP.'
        : 'Add a card + STRIPE_PROFILE_ID, or use PROPERTY_GATE_MODE=mpp with MPP client fetch (default).';
      return {
        success: false,
        error: `Legacy SPT header: no token — ${hint}`,
        http_status: 0,
      };
    }
  }

  let res;
  try {
    if (method === 'GET') {
      res = await fetch(url, { method: 'GET', headers });
    } else {
      res = await fetch(url, {
        method: method === 'POST' || method === 'PUT' || method === 'PATCH' ? method : 'POST',
        headers,
        body: JSON.stringify(args ?? {}),
      });
    }
  } catch (e) {
    return { success: false, error: `HTTP tool failed: ${e.message}` };
  }

  const text = await res.text();
  let bodyJson = null;
  try {
    bodyJson = text ? JSON.parse(text) : null;
  } catch {
    bodyJson = text;
  }

  if (!res.ok) {
    return {
      success: false,
      http_status: res.status,
      error: typeof bodyJson === 'object' && bodyJson && bodyJson.error ? bodyJson.error : res.statusText,
      response_body: bodyJson,
    };
  }

  return { success: true, http_status: res.status, data: bodyJson };
}
