/**
 * Workshop starter: all tool calls flow through this one function.
 *
 * Attendee task:
 * 1) Do one HTTP call for free + paid tools.
 * 2) If HTTP 402 and paid tool, mint SPT + retry.
 * 3) Return normalized result for the model.
 *
 * Helpful docs:
 * - https://docs.stripe.com/payments/machine/mpp
 * - https://www.npmjs.com/package/mppx
 *
 * @param {any} toolDef
 * @param {Record<string, unknown>} args
 * @param {{ session?: import('express-session').Session, mintSpt?: (ctx?: Record<string, unknown>) => Promise<string | null> }} [_invokeOpts]
 */
export async function runWorkshopToolCall(toolDef, args, _invokeOpts = {}) {
  if (!toolDef || typeof toolDef !== 'object') {
    return { success: false, http_status: 0, error: 'Invalid tool definition' };
  }

  const mode = toolDef?.mpp === true || toolDef?.mpp_spt === true ? 'mpp' : 'free';
  const url = String(toolDef?.http?.url || '').trim();
  if (!url) return { success: false, http_status: 0, mode, error: 'Missing tool http.url' };

  // TODO(workshop): implement this flow
  //
  // const method = String(toolDef?.http?.method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST';
  // const headers = Object.fromEntries(
  //   Object.entries(toolDef?.http?.headers || {}).filter(([, v]) => typeof v === 'string' && !!v)
  // );
  // if (method !== 'GET' && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  //
  // // 1) First request (shared path for free + paid tools)
  // // 2) Parse response JSON/text
  // // 3) Shared 402 handling:
  // //    - free + 402 => return clear config error
  // //    - paid + 402 => call _invokeOpts.mintSpt(...), retry with payment header
  // // 4) Return normalized shape:
  // //    { success, http_status, mode, mpp, response_body, error?, payment_receipt? }

  return {
    success: false,
    http_status: 0,
    mode,
    mpp: mode === 'mpp',
    stub: true,
    error: 'Workshop stub: implement runWorkshopToolCall for free + MPP paid tools.',
    next_steps: [
      'Make first HTTP call for the tool.',
      'If 402 on paid tool: mint SPT and retry.',
      'Return normalized success/error payload.',
    ],
    hint: `Route: ${url}`,
    args_preview: args || {},
  };
}

