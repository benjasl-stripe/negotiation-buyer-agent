import express from 'express';
import { runConversation, isOpenAIConfigured, openAiMode } from '../lib/openai.js';
import { getManifestToolsState, reloadManifestTools } from '../lib/tools-manifest.js';
import { createMppInvokeBinder } from '../lib/agent-wallet.js';
import { getPracticeChatConfig, normalizePracticeChatRole } from '../lib/practice-chat-prompts.js';

const router = express.Router();

function resolveChatRun(body) {
  const agentRole = normalizePracticeChatRole(body?.agentRole ?? body?.role);
  const config = getPracticeChatConfig(agentRole);
  const customSystem = typeof body?.system === 'string' && body.system.trim() ? body.system.trim() : '';
  return {
    agentRole,
    systemPrompt: customSystem || config.systemPrompt,
    toolsEnabled: config.toolsEnabled,
    label: config.label,
  };
}

function sseWrite(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

router.post('/stream', async (req, res) => {
  if (!isOpenAIConfigured()) {
    return res.status(503).json({
      error: 'OpenAI not configured — set LAMBDA_ENDPOINT + WORKSHOP_SECRET or OPENAI_API_KEY in .env',
    });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Body must include messages: [{ role, content }, ...]' });
  }

  const run = resolveChatRun(req.body);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  try {
    const mppInvoke = createMppInvokeBinder(req);
    const out = await runConversation(messages, {
      systemPrompt: run.systemPrompt,
      toolsEnabled: run.toolsEnabled,
      mppInvoke: run.toolsEnabled ? mppInvoke : undefined,
      onActivity: (step) => {
        sseWrite(res, { type: 'activity', step });
        if (step.t === 'tool_result') {
          sseWrite(res, { type: 'spend_refresh' });
        }
      },
    });
    sseWrite(res, { type: 'done', agentRole: run.agentRole, agentLabel: run.label, ...out });
  } catch (e) {
    console.error('[chat stream]', e);
    sseWrite(res, { type: 'error', error: e instanceof Error ? e.message : String(e) });
  }
  res.end();
});

router.post('/', async (req, res) => {
  if (!isOpenAIConfigured()) {
    return res.status(503).json({
      error: 'OpenAI not configured — set LAMBDA_ENDPOINT + WORKSHOP_SECRET or OPENAI_API_KEY in .env',
    });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Body must include messages: [{ role, content }, ...]' });
  }

  const run = resolveChatRun(req.body);

  try {
    const mppInvoke = createMppInvokeBinder(req);
    const out = await runConversation(messages, {
      systemPrompt: run.systemPrompt,
      toolsEnabled: run.toolsEnabled,
      mppInvoke: run.toolsEnabled ? mppInvoke : undefined,
    });
    return res.json({ agentRole: run.agentRole, agentLabel: run.label, ...out });
  } catch (e) {
    console.error('[chat]', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get('/meta', (_req, res) => {
  const st = getManifestToolsState();
  const buyer = getPracticeChatConfig('buyer');
  const seller = getPracticeChatConfig('seller');
  res.json({
    manifestPath: st.path,
    toolNames: st.tools.map((t) => t.name),
    openai: isOpenAIConfigured(),
    openaiMode: openAiMode(),
    practiceChat: {
      roles: [
        { id: 'buyer', label: buyer.label, toolsEnabled: buyer.toolsEnabled },
        { id: 'seller', label: seller.label, toolsEnabled: seller.toolsEnabled },
      ],
      defaultRole: 'buyer',
    },
  });
});

router.post('/reload-manifest', (_req, res) => {
  reloadManifestTools();
  const st = getManifestToolsState();
  res.json({ ok: true, manifestPath: st.path, toolNames: st.tools.map((t) => t.name) });
});

export default router;
