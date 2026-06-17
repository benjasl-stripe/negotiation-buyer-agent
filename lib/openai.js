/**
 * OpenAI chat + optional function calling (manifest tools only).
 * Use LAMBDA_ENDPOINT + WORKSHOP_SECRET for workshop ai-chat proxy, or OPENAI_API_KEY for direct calls.
 */
import { getManifestToolsState, invokeManifestHttpTool } from './tools-manifest.js';

function getLambdaEndpoint() {
  const raw = (process.env.LAMBDA_ENDPOINT || '').trim();
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}

function getWorkshopSecret() {
  return (process.env.WORKSHOP_SECRET || '').trim();
}

export function isOpenAIConfigured() {
  return !!(getLambdaEndpoint() || (process.env.OPENAI_API_KEY || '').trim());
}

/** @returns {'lambda' | 'direct' | 'none'} */
export function openAiMode() {
  if (getLambdaEndpoint()) return 'lambda';
  if ((process.env.OPENAI_API_KEY || '').trim()) return 'direct';
  return 'none';
}

function openAiChatCompletionsUrl() {
  const explicit = (process.env.OPENAI_CHAT_COMPLETIONS_URL || '').trim();
  if (explicit) return explicit;
  const base = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
  return `${base}/chat/completions`;
}

function toOpenAiToolList(toolsEnabled = true) {
  if (!toolsEnabled) return undefined;
  const { openaiTools } = getManifestToolsState();
  return openaiTools.length ? openaiTools : undefined;
}

/**
 * @param {{ tools: { name: string }[] }} state
 * @param {boolean} toolsEnabled
 */
function manifestToolPromptBlock(state, toolsEnabled) {
  if (!toolsEnabled) {
    return `Runtime tools: none (tool calling disabled for this run).`;
  }
  const names = (state?.tools || []).map((t) => t.name).filter(Boolean);
  if (!names.length) {
    return `Runtime tools from manifest: none.
If asked what tools you have, answer "none configured in manifest". Do not invent tool names.`;
  }
  return `Runtime tools from manifest (only these are available):
${names.map((n) => `- ${n}`).join('\n')}
If asked what tools you have, list only names from this section. Do not infer or invent additional tools.`;
}

async function chatOnceViaLambda(conversation, opts = {}) {
  const toolsEnabled = opts.toolsEnabled !== false;
  const endpoint = getLambdaEndpoint();
  const secret = getWorkshopSecret();
  if (!endpoint) throw new Error('LAMBDA_ENDPOINT is not set');
  if (!secret) {
    throw new Error('WORKSHOP_SECRET is not set (required when using LAMBDA_ENDPOINT)');
  }

  const tools = toOpenAiToolList(toolsEnabled);
  let workshopContext = '';
  let apiMessages = conversation;
  if (conversation[0]?.role === 'system') {
    workshopContext = String(conversation[0].content || '');
    apiMessages = conversation.slice(1);
  }

  const response = await fetch(`${endpoint}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workshop-Secret': secret,
    },
    body: JSON.stringify({
      messages: apiMessages,
      workshopContext,
      enableFunctionCalling: !!(tools?.length),
      tools: tools?.length ? tools : undefined,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: Number(process.env.OPENAI_TEMPERATURE) || 0.6,
      max_tokens: Number(process.env.OPENAI_MAX_TOKENS) || 1200,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Lambda AI error: ${response.status}`);
  }

  const data = await response.json();
  if (data.type === 'tool_calls' && data.tool_calls?.length) {
    return {
      type: 'tool_calls',
      tool_calls: data.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments:
          typeof tc.arguments === 'object' && tc.arguments !== null
            ? tc.arguments
            : JSON.parse(tc.arguments || '{}'),
      })),
      assistant_message: data.assistant_message,
    };
  }

  return { type: 'text', content: data.content || '' };
}

async function chatOnce(messages, opts = {}) {
  const toolsEnabled = opts.toolsEnabled !== false;
  if (getLambdaEndpoint()) return chatOnceViaLambda(messages, { toolsEnabled });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Set LAMBDA_ENDPOINT + WORKSHOP_SECRET or OPENAI_API_KEY in .env');
  }

  const tools = toOpenAiToolList(toolsEnabled);
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const body = {
    model,
    messages,
    temperature: Number(process.env.OPENAI_TEMPERATURE) || 0.6,
    max_tokens: Number(process.env.OPENAI_MAX_TOKENS) || 1200,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const response = await fetch(openAiChatCompletionsUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI error: ${response.status}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const message = choice?.message;
  if (!message) throw new Error('Empty OpenAI response');

  if (choice.finish_reason === 'tool_calls' && message.tool_calls?.length) {
    return {
      type: 'tool_calls',
      tool_calls: message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      })),
      assistant_message: message,
    };
  }

  return { type: 'text', content: message.content || '' };
}

const DEFAULT_SYSTEM = `You are a lab agent for a negotiation workshop. Help the user explore terms, compare options, and converge on a clear deal summary (parties, scope, price or consideration, timing, and any open questions). When tools are available, **you** call them for structured data from their backends—do not ask the user to run tools or paste long excerpts for you; invoke the functions yourself. Stay concise and neutral; do not invent binding commitments the user did not state.

If a tool fails because **no payment method is on file**, tell the user to click **Add payment method** in the lab header, save a card with Stripe Elements, then retry.

If the error mentions **Stripe profile**, **issued token**, **API key** (in the SPT / shared payment context), or the failure clearly happened during **SPT mint** (not HTTP 402 from the property API), the fix is usually **\`.env\` on the agent**: set **\`STRIPE_PROFILE_ID\`** to a \`profile_…\` for the same Stripe account as **\`STRIPE_SECRET_KEY\`** (see \`npm run wallet:print-profile\`), or set **\`MPP_SPT_MINT_MODE=test_helper\`**. Do **not** only repeat “add a card” when a card is already on file.

When a tool returns long text (e.g. property markdown), cite **which tool** you used, the **section heading** (## …) or a **brief quote / number** you rely on, so price or concession advice is traceable. If you have not called the tool yet, call it before claiming what the document says.`;

/**
 * @param {{ role: string, content?: string, tool_calls?: unknown, tool_call_id?: string, name?: string }[]} messages
 * @param {{
 *   systemPrompt?: string,
 *   maxIterations?: number,
 *   onActivity?: (step: { t: string, text: string, name?: string }) => void,
 *   mppInvoke?: { session: import('express-session').Session, mintSpt?: () => Promise<string|null> },
 *   mintSpt?: () => Promise<string|null>,
 *   toolsEnabled?: boolean,
 * }} opts
 */
export async function runConversation(messages, opts = {}) {
  const systemPrompt = opts.systemPrompt || process.env.AGENT_SYSTEM_PROMPT || DEFAULT_SYSTEM;
  const maxIterations = opts.maxIterations ?? 12;
  const toolsEnabled = opts.toolsEnabled !== false;
  const onActivity = typeof opts.onActivity === 'function' ? opts.onActivity : null;
  const mppInvoke = opts.mppInvoke || null;
  const mintSpt =
    typeof opts.mintSpt === 'function'
      ? opts.mintSpt
      : mppInvoke && typeof mppInvoke.mintSpt === 'function'
        ? mppInvoke.mintSpt
        : null;

  const state = getManifestToolsState();
  const runtimeToolsContext = manifestToolPromptBlock(state, toolsEnabled);
  const conversation = [{ role: 'system', content: `${systemPrompt}\n\n${runtimeToolsContext}` }, ...messages];
  /** @type {{ t: string, text: string, name?: string }[]} */
  const activity = [];

  const pushActivity = (entry) => {
    activity.push(entry);
    if (onActivity) {
      try {
        onActivity({ t: entry.t, text: entry.text, ...(entry.name != null ? { name: entry.name } : {}) });
      } catch (_) {
        /* ignore stream/UI errors */
      }
    }
  };

  for (let iter = 0; iter < maxIterations; iter++) {
    const response = await chatOnce(conversation, { toolsEnabled });

    if (response.type === 'text') {
      pushActivity({
        t: 'text',
        text: 'Decided: replying to the other party in text (no further tool calls this buyer turn).',
      });
      return {
        content: response.content,
        iterations: iter + 1,
        manifestPath: state.path,
        toolCount: state.tools.length,
        activity,
      };
    }

    const names = response.tool_calls.map((tc) => tc.name).join(', ');
    pushActivity({
      t: 'tool_choice',
      text: `Decided: call ${response.tool_calls.length} tool(s) — ${names}`,
    });

    conversation.push(response.assistant_message);

    for (const tc of response.tool_calls) {
      const argKeys = Object.keys(tc.arguments || {});
      const argHint = argKeys.length ? ` with { ${argKeys.join(', ')} }` : '';
      pushActivity({
        t: 'tool_call',
        name: tc.name,
        text: `Running \`${tc.name}\`${argHint}…`,
      });

      const def = state.byName.get(tc.name);
      const invokeCtx = mppInvoke
        ? { session: mppInvoke.session, mintSpt: mintSpt || undefined }
        : mintSpt
          ? { mintSpt }
          : {};
      const result = def
        ? await invokeManifestHttpTool(def, tc.arguments, invokeCtx)
        : { success: false, error: `Unknown tool: ${tc.name}` };

      if (result.success) {
        pushActivity({
          t: 'tool_result',
          name: tc.name,
          text: `\`${tc.name}\` finished (HTTP ${result.http_status ?? 'ok'}).`,
        });
      } else {
        const errDetail =
          result.error ??
          (result.http_status != null ? `HTTP ${result.http_status}` : 'unknown error');
        pushActivity({
          t: 'tool_error',
          name: tc.name,
          text: `\`${tc.name}\` failed: ${errDetail}.`,
        });
      }

      conversation.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  pushActivity({ t: 'limit', text: `Stopped: exceeded max tool rounds (${maxIterations}).` });
  throw new Error(`Exceeded max tool iterations (${maxIterations})`);
}

/**
 * Single chat completion (no tools). Used for the seller agent.
 * @param {{ role: string, content?: string }[]} messages Full OpenAI messages including system first.
 * @param {{ model?: string, temperature?: number, max_tokens?: number }} [opts]
 */
export async function runChatCompletion(messages, opts = {}) {
  const model =
    opts.model || process.env.OPENAI_MODEL_SELLER || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (getLambdaEndpoint()) {
    const secret = getWorkshopSecret();
    if (!secret) throw new Error('WORKSHOP_SECRET is not set (required when using LAMBDA_ENDPOINT)');

    let workshopContext = '';
    let apiMessages = messages;
    if (messages[0]?.role === 'system') {
      workshopContext = String(messages[0].content || '');
      apiMessages = messages.slice(1);
    }

    const response = await fetch(`${getLambdaEndpoint()}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workshop-Secret': secret,
      },
      body: JSON.stringify({
        messages: apiMessages,
        workshopContext,
        enableFunctionCalling: false,
        model,
        temperature: opts.temperature ?? 0.65,
        max_tokens: opts.max_tokens ?? 900,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || err.message || `Lambda AI error: ${response.status}`);
    }

    const data = await response.json();
    return (data.content || '').trim();
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Set LAMBDA_ENDPOINT + WORKSHOP_SECRET or OPENAI_API_KEY in .env');

  const response = await fetch(openAiChatCompletionsUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.65,
      max_tokens: opts.max_tokens ?? 900,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI error: ${response.status}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const message = choice?.message;
  if (!message) throw new Error('Empty OpenAI response');
  return (message.content || '').trim();
}
