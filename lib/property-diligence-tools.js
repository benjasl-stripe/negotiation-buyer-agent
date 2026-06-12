/**
 * The ten MPP property diligence tools — sole ground truth for buyer property claims.
 */
export const PROPERTY_DILIGENCE_TOOLS = [
  'property_seller_disclosure',
  'property_hoa_packet',
  'property_title_preliminary',
  'property_inspection_report',
  'property_tax_history',
  'property_flood_hazard',
  'property_comparable_sales',
  'property_schools',
  'property_utilities_energy',
  'property_permits_renovations',
];

/** Human-readable document labels (for seller orchestrator context — not spoken to buyer). */
export const TOOL_TO_DOC_LABEL = {
  property_seller_disclosure: 'seller disclosure',
  property_hoa_packet: 'HOA packet',
  property_title_preliminary: 'preliminary title report',
  property_inspection_report: 'home inspection report',
  property_tax_history: 'tax history',
  property_flood_hazard: 'flood/hazard report',
  property_comparable_sales: 'comparable sales report',
  property_schools: 'schools report',
  property_utilities_energy: 'utilities/energy report',
  property_permits_renovations: 'permits/renovations report',
};

export const BUYER_EVIDENCE_CITATION_RULES = `**Property facts — no fabrication:** Ground truth for this property exists only in these diligence sources (you retrieve them via tools): ${PROPERTY_DILIGENCE_TOOLS.join(', ')}.

**Before any property-specific claim** in your message to the seller (condition, liens, HOA, flood, comps, tax, title, utilities, permits, schools, etc.), you **must** call the matching tool in the same turn or rely on output you already fetched this session — unless you are only asking a question with no factual assertion.

**When citing diligence to the seller**, make every claim auditable in the same message:
- Name the **tool** (OpenAI function name, e.g. \`property_inspection_report\`).
- Cite the **markdown section heading** (e.g. \`## 2. Roof & exterior\`) and/or a **short quote or figure** from the tool output.
- Do **not** invent document contents, repair estimates, claim numbers, or comp addresses. If you have not retrieved a source yet, call the tool first.

The seller is instructed to **reject uncited property claims** and ignore claims that do not match purchased diligence.`;

/**
 * @param {unknown} name
 */
export function isPropertyDiligenceTool(name) {
  return typeof name === 'string' && PROPERTY_DILIGENCE_TOOLS.includes(name);
}

/**
 * @param {unknown} activity
 * @returns {string[]}
 */
export function collectToolsFromBuyerActivity(activity) {
  if (!Array.isArray(activity)) return [];
  const seen = new Set();
  for (const step of activity) {
    if (!step || typeof step !== 'object') continue;
    if (typeof step.name === 'string' && isPropertyDiligenceTool(step.name)) {
      seen.add(step.name);
    }
    const text = typeof step.text === 'string' ? step.text : '';
    for (const tool of PROPERTY_DILIGENCE_TOOLS) {
      if (text.includes('`' + tool + '`') || text.includes(tool)) seen.add(tool);
    }
  }
  return [...seen];
}

/**
 * @param {import('express-session').Session & { negRunSpendLog?: { toolName?: string }[] }} [session]
 * @returns {string[]}
 */
export function collectToolsFromNegotiationSession(session) {
  const log = session && Array.isArray(session.negRunSpendLog) ? session.negRunSpendLog : [];
  return [...new Set(log.map((r) => r.toolName).filter(isPropertyDiligenceTool))];
}

/**
 * @param {...string[]} lists
 * @returns {string[]}
 */
export function mergePurchasedTools(...lists) {
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const t of list) {
      if (isPropertyDiligenceTool(t)) seen.add(t);
    }
  }
  return PROPERTY_DILIGENCE_TOOLS.filter((t) => seen.has(t));
}

/**
 * @param {string[]} tools
 */
export function formatPurchasedToolsForSeller(tools) {
  if (!tools.length) return 'none purchased yet this session';
  return tools.map((t) => TOOL_TO_DOC_LABEL[t] || t).join('; ');
}
