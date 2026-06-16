import express from 'express';
import { isOpenAIConfigured, openAiMode } from '../lib/openai.js';
import { isExternalSellerEnabled } from '../lib/seller-client.js';
import { isJudgeServiceEnabled, remoteEventsList, remoteJudgeEvaluate } from '../lib/judge-client.js';
import { buildJudgePayload } from '../lib/negotiation-judge-payload.js';
import { runNegotiation } from '../lib/negotiation.js';
import { createMppInvokeBinder, getNegotiationSpendSummary } from '../lib/agent-wallet.js';

const router = express.Router();

router.get('/judge-config', (_req, res) => {
  res.json({
    configured: isJudgeServiceEnabled(),
    endpoint: isJudgeServiceEnabled() ? 'POST /api/negotiation/judge' : null,
  });
});

router.get('/events', async (_req, res) => {
  if (!isJudgeServiceEnabled()) {
    return res.status(503).json({ error: 'JUDGE_SERVICE_URL is not set' });
  }
  try {
    const data = await remoteEventsList();
    return res.json(data);
  } catch (e) {
    console.error('[judge events]', e);
    return res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post('/judge', async (req, res) => {
  if (!isJudgeServiceEnabled()) {
    return res.status(503).json({
      error: 'JUDGE_SERVICE_URL is not set — deploy negotiation-judge-service and set JUDGE_SERVICE_URL in .env',
    });
  }

  const body = req.body || {};
  if (!Array.isArray(body.transcript) || body.transcript.length === 0) {
    return res.status(400).json({ error: 'Body must include transcript (non-empty array)' });
  }
  if (typeof body.outcome !== 'string' || !body.outcome.trim()) {
    return res.status(400).json({ error: 'Body must include outcome (agreed | walked | max_rounds)' });
  }

  try {
    const spend = body.negotiationSpend || getNegotiationSpendSummary(req.session);
    const payload = buildJudgePayload(
      {
        ...body,
        buyerGoal: typeof body.buyerGoal === 'string' ? body.buyerGoal : body.buyer_mandate,
        negotiationSpend: spend,
      },
      req.session
    );
    const result = await remoteJudgeEvaluate({
      ...payload,
      endedBy: body.endedBy,
      whoStarts: body.whoStarts,
    });
    return res.json(result);
  } catch (e) {
    console.error('[negotiation judge]', e);
    return res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get('/spend', (req, res) => {
  res.json({
    active: !!req.session.negRunActive,
    ...getNegotiationSpendSummary(req.session),
  });
});

function sseWrite(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

router.post('/run-stream', async (req, res) => {
  if (!isOpenAIConfigured()) {
    return res.status(503).json({
      error: 'OpenAI not configured — set LAMBDA_ENDPOINT + WORKSHOP_SECRET or OPENAI_API_KEY in .env',
    });
  }
  if (!isExternalSellerEnabled()) {
    return res.status(503).json({ error: 'SELLER_SERVICE_URL is not set (negotiation uses remote seller-service only)' });
  }

  const { buyerGoal, maxRounds, buyerSystemPrompt } = req.body || {};

  if (typeof buyerGoal !== 'string' || !buyerGoal.trim()) {
    return res.status(400).json({ error: 'Body must include buyerGoal (string)' });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  try {
    const mppInvoke = createMppInvokeBinder(req);
    await runNegotiation({
      buyerGoal: buyerGoal.trim(),
      maxRounds,
      buyerSystemPrompt: typeof buyerSystemPrompt === 'string' ? buyerSystemPrompt : undefined,
      onProgress: (evt) => sseWrite(res, evt),
      mppInvoke,
    });
  } catch (e) {
    console.error('[negotiation stream]', e);
    sseWrite(res, { type: 'error', error: e instanceof Error ? e.message : String(e) });
  }
  res.end();
});

router.post('/run', async (req, res) => {
  if (!isOpenAIConfigured()) {
    return res.status(503).json({
      error: 'OpenAI not configured — set LAMBDA_ENDPOINT + WORKSHOP_SECRET or OPENAI_API_KEY in .env',
    });
  }
  if (!isExternalSellerEnabled()) {
    return res.status(503).json({ error: 'SELLER_SERVICE_URL is not set (negotiation uses remote seller-service only)' });
  }

  const { buyerGoal, maxRounds, buyerSystemPrompt } = req.body || {};

  if (typeof buyerGoal !== 'string' || !buyerGoal.trim()) {
    return res.status(400).json({ error: 'Body must include buyerGoal (string)' });
  }

  try {
    const mppInvoke = createMppInvokeBinder(req);
    const out = await runNegotiation({
      buyerGoal: buyerGoal.trim(),
      maxRounds,
      buyerSystemPrompt: typeof buyerSystemPrompt === 'string' ? buyerSystemPrompt : undefined,
      mppInvoke,
    });
    return res.json(out);
  } catch (e) {
    console.error('[negotiation]', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
