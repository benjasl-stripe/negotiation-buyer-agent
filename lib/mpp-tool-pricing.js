import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mppToolCostCents } from './agent-wallet.js';

/** @type {Record<string, string> | null} */
let routePrices = null;

function loadRoutePrices() {
  if (routePrices) return routePrices;
  try {
    const p = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/mpp-route-prices.json');
    routePrices = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    routePrices = { default: '0.50' };
  }
  return routePrices;
}

/**
 * @param {string} urlStr
 */
export function fiatUsdForUrl(urlStr) {
  const prices = loadRoutePrices();
  let pathname = '';
  try {
    pathname = new URL(urlStr).pathname;
  } catch {
    pathname = '';
  }
  const raw = prices[pathname] ?? prices.default ?? '0.50';
  const usd = parseFloat(String(raw));
  return Number.isFinite(usd) && usd > 0 ? usd : 0.5;
}

/**
 * @param {any} toolDef
 */
export function fiatCentsForTool(toolDef) {
  if (toolDef?.mpp_fiat_usd != null) {
    const usd = parseFloat(String(toolDef.mpp_fiat_usd));
    if (Number.isFinite(usd) && usd > 0) return Math.max(1, Math.round(usd * 100));
  }
  const url = toolDef?.http?.url;
  if (typeof url === 'string' && url.trim()) {
    const usd = fiatUsdForUrl(url.trim());
    return Math.max(1, Math.round(usd * 100));
  }
  return mppToolCostCents();
}
