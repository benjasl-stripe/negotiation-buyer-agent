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

  const method = String(toolDef?.http?.method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST';
  /** @type {Record<string, string>} */
  const headers = Object.fromEntries(
    Object.entries(toolDef?.http?.headers || {}).filter(([, v]) => typeof v === 'string' && !!v)
  );
  if (method !== 'GET' && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const withQuery = () => {
    const u = new URL(url);
    for (const [k, v] of Object.entries(args || {})) {
      if (v != null && v !== '') u.searchParams.set(k, String(v));
    }
    return u.toString();
  };

  /** @param {Response} res */
  const parseResponse = async (res) => {
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return data;
  };

  /** @param {Record<string, string>} callHeaders */
  const callTool = async (callHeaders) => {
    const res =
      method === 'GET'
        ? await fetch(withQuery(), { method: 'GET', headers: callHeaders })
        : await fetch(url, { method, headers: callHeaders, body: JSON.stringify(args || {}) });
    const data = await parseResponse(res);
    return { res, data };
  };

  /** @param {Response} res @param {unknown} data @param {Record<string, unknown>} extra */
  const normalize = (res, data, extra = {}) => {
    const error =
      typeof data === 'object' && data && (data.error || data.detail || data.message)
        ? String(data.error || data.detail || data.message)
        : res.statusText || `HTTP ${res.status}`;
    return {
      success: res.ok,
      http_status: res.status,
      mode: typeof extra.mode === 'string' ? extra.mode : mode,
      mpp: typeof extra.mpp === 'boolean' ? extra.mpp : mode === 'mpp',
      response_body: data,
      ...(res.ok ? {} : { error }),
      ...extra,
    };
  };

  try {
    // 1) First request (shared path for free + paid tools).
    const first = await callTool(headers);
    if (first.res.status !== 402) return normalize(first.res, first.data);

    // 2) Build challenge details for UI/logs.
    const challenge = {
      payment_required: true,
      www_authenticate: first.res.headers.get('www-authenticate') || null,
      response_body: first.data,
    };

    // 3a) Preferred path: let mppx client handle challenge credentials/retry.
    if (_invokeOpts?.session && toolDef?.mpp_legacy_header !== true) {
      const { fetchWithMpp } = await import('./mpp-client.js');
      const paidRes =
        method === 'GET'
          ? await fetchWithMpp(_invokeOpts.session, withQuery(), { method: 'GET', headers })
          : await fetchWithMpp(_invokeOpts.session, url, {
              method,
              headers,
              body: JSON.stringify(args || {}),
            });
      const paidData = await parseResponse(paidRes);
      const paymentReceipt =
        paidRes.headers.get('payment-receipt') ||
        paidRes.headers.get('x-payment-receipt') ||
        (typeof paidData === 'object' && paidData ? paidData.payment_receipt || null : null);
      return normalize(paidRes, paidData, {
        mode: 'mpp',
        mpp: true,
        payment_challenge: challenge,
        payment_receipt: paymentReceipt,
      });
    }

    // 3b) Fallback for legacy SPT-header flows.
    if (typeof _invokeOpts?.mintSpt !== 'function') {
      return {
        success: false,
        http_status: 402,
        mode: 'mpp',
        mpp: true,
        payment_required: true,
        challenge,
        error: '402 challenge received, but no mintSpt callback available for retry.',
      };
    }

    const challengePayload =
      typeof challenge.response_body === 'object' && challenge.response_body
        ? challenge.response_body
        : {};
    const spt = await _invokeOpts.mintSpt({
      toolDef,
      args: args || {},
      challenge,
      ...challengePayload,
    });
    if (!spt) {
      return {
        success: false,
        http_status: 402,
        mode: 'mpp',
        mpp: true,
        payment_required: true,
        challenge,
        error: 'Failed to mint SPT.',
      };
    }

    const paidHeaders = {
      ...headers,
      ...(toolDef?.mpp_legacy_header === true
        ? { 'X-Shared-Payment-Token': spt }
        : { Authorization: `Bearer ${spt}`, 'X-Shared-Payment-Token': spt }),
    };
    const retry = await callTool(paidHeaders);
    const paymentReceipt =
      retry.res.headers.get('payment-receipt') ||
      retry.res.headers.get('x-payment-receipt') ||
      (typeof retry.data === 'object' && retry.data ? retry.data.payment_receipt || null : null);
    return normalize(retry.res, retry.data, {
      mode: 'mpp',
      mpp: true,
      payment_challenge: challenge,
      payment_receipt: paymentReceipt,
    });
  } catch (e) {
    return {
      success: false,
      http_status: 0,
      mode,
      mpp: mode === 'mpp',
      error: `Tool call failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

