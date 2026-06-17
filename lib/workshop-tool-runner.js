/**
 * Workshop starter: all tool calls flow through this one function.
 *
 * Attendee task:
 * 1) Do one HTTP call for free + paid tools.
 * 2) If HTTP 402, handle MPP challenge and retry.
 * 3) Return normalized result for the model.
 *
 * Helpful docs:
 * - https://docs.stripe.com/payments/machine/mpp
 * - https://www.npmjs.com/package/mppx
 * - https://docs.stripe.com/payments/machine/quickstart
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
  if (!url) {
    return { success: false, http_status: 0, mode, mpp: mode === 'mpp', error: 'Missing tool http.url' };
  }

  // ---------------------------------------------------------------------------
  // STUBBED STARTER
  // ---------------------------------------------------------------------------
  // This workshop version intentionally does NOT execute network calls yet.
  // Keep this return shape stable so model/tool orchestration continues to work
  // while implementation is in progress.
  //
  // Hints:
  // - Build `method`, `headers`, and request URL from `toolDef.http`.
  // - Make one first request for every tool (free + paid).
  // - If response is not 402, parse body and return normalized result.
  // - If response is 402:
  //   - Preferred: use `fetchWithMpp(session, url, init)` from `./mpp-client.js`
  //   - Fallback: call `_invokeOpts.mintSpt(...)`, then retry with payment headers
  // - Include `payment_receipt` if present in headers/body.
  // - Normalize error text from `error`, `detail`, or `message` fields.
  return {
    success: false,
    http_status: 0,
    mode,
    mpp: mode === 'mpp',
    error: 'TODO: implement runWorkshopToolCall in lib/workshop-tool-runner.js',
    response_body: {
      tool: toolDef?.name || null,
      args: args || {},
    },
    next_steps: [
      'Build request URL/method/headers from toolDef.http',
      'Make one initial HTTP request for both free and paid tools',
      'If status is 402, handle challenge and retry with payment credentials',
      'Return normalized result with success/http_status/error/response_body',
    ],
  };
}

