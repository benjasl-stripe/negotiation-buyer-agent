import express from 'express';
import { randomUUID } from 'crypto';
import { isOpenAIConfigured, openAiMode } from '../lib/openai.js';
import { isExternalSellerEnabled } from '../lib/seller-client.js';
import { isJudgeServiceEnabled, remoteEventsList, remoteJudgeEvaluate } from '../lib/judge-client.js';
import { buildJudgePayload } from '../lib/negotiation-judge-payload.js';
import { runNegotiation } from '../lib/negotiation.js';
import { createMppInvokeBinder, getNegotiationSpendSummary } from '../lib/agent-wallet.js';

const router = express.Router();
const PENDING_JUDGE_RUN_TTL_MS = 10 * 60 * 1000;

/**
 * @param {import('express').Request} req
 * @param {Record<string, unknown>} runResult
 * @param {string} buyerGoal
 */
function rememberNegotiationForJudge(req, runResult, buyerGoal) {
  req.session.pendingJudgeRun = {
    runId: randomUUID(),
    createdAt: Date.now(),
    judgedAt: null,
    judgeResult: null,
    buyerGoal,
    result: runResult,
  };
}

/**
 * @param {import('express').Request} req
 */
function getPendingJudgeRun(req) {
  const pending = req.session.pendingJudgeRun;
  if (!pending || typeof pending !== 'object') return null;
  const createdAt = Number(pending.createdAt || 0);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
  if (Date.now() - createdAt > PENDING_JUDGE_RUN_TTL_MS) {
    req.session.pendingJudgeRun = null;
    return null;
  }
  return pending;
}

/**
 * @param {import('express').Request} req
 */
function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * @param {import('express').Request} req
 * @param {Record<string, unknown>} runResult
 * @param {{ buyerGoal?: string, buyerName?: string, event_id?: string, eventId?: string }} overrides
 */
async function evaluateNegotiationServerSide(req, runResult, overrides = {}) {
  if (!isJudgeServiceEnabled()) return { skipped: true, error: 'Judge scoring not configured on server' };
  const spend = runResult.negotiationSpend || getNegotiationSpendSummary(req.session);
  const payload = buildJudgePayload(
    {
      ...runResult,
      buyerGoal:
        typeof overrides.buyerGoal === 'string' && overrides.buyerGoal.trim()
          ? overrides.buyerGoal
          : typeof runResult.buyerGoal === 'string'
            ? runResult.buyerGoal
            : '',
      buyerName:
        typeof overrides.buyerName === 'string' && overrides.buyerName.trim()
          ? overrides.buyerName
          : typeof runResult.buyerName === 'string'
            ? runResult.buyerName
            : '',
      event_id:
        typeof overrides.event_id === 'string' && overrides.event_id.trim()
          ? overrides.event_id
          : typeof overrides.eventId === 'string' && overrides.eventId.trim()
            ? overrides.eventId
            : typeof runResult.event_id === 'string'
              ? runResult.event_id
              : undefined,
      negotiationSpend: spend,
    },
    req.session
  );
  const result = await remoteJudgeEvaluate({
    ...payload,
    endedBy: runResult.endedBy,
    whoStarts: runResult.whoStarts,
  });
  return { skipped: false, result };
}

router.get('/judge-config', (_req, res) => {
  res.json({
    configured: isJudgeServiceEnabled(),
    endpoint: null,
    mode: 'backend_only',
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
  return res.status(410).json({
    error: 'Client-triggered judge requests are disabled. Judging is performed server-side during negotiation runs.',
  });
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

  const { buyerGoal, maxRounds, buyerSystemPrompt, event_id, eventId, buyerName } = req.body || {};

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
    req.session.pendingJudgeRun = null;
    const out = await runNegotiation({
      buyerGoal: buyerGoal.trim(),
      maxRounds,
      buyerSystemPrompt: typeof buyerSystemPrompt === 'string' ? buyerSystemPrompt : undefined,
      onProgress: (evt) => sseWrite(res, evt),
      mppInvoke,
    });
    rememberNegotiationForJudge(req, out, buyerGoal.trim());
    sseWrite(res, { type: 'judge_pending', message: 'Scoring negotiation on server…' });
    try {
      const judged = await evaluateNegotiationServerSide(req, out, {
        buyerGoal: buyerGoal.trim(),
        buyerName: typeof buyerName === 'string' ? buyerName : '',
        event_id: typeof event_id === 'string' ? event_id : undefined,
        eventId: typeof eventId === 'string' ? eventId : undefined,
      });
      if (judged.skipped) {
        sseWrite(res, { type: 'judge_skipped', error: judged.error });
      } else {
        const pending = getPendingJudgeRun(req) || {};
        req.session.pendingJudgeRun = {
          ...pending,
          judgedAt: Date.now(),
          judgeResult: judged.result,
        };
        sseWrite(res, { type: 'judge_result', judge: judged.result });
      }
    } catch (e) {
      sseWrite(res, { type: 'judge_error', error: e instanceof Error ? e.message : String(e) });
    }
    await saveSession(req);
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

  const { buyerGoal, maxRounds, buyerSystemPrompt, event_id, eventId, buyerName } = req.body || {};

  if (typeof buyerGoal !== 'string' || !buyerGoal.trim()) {
    return res.status(400).json({ error: 'Body must include buyerGoal (string)' });
  }

  try {
    const mppInvoke = createMppInvokeBinder(req);
    req.session.pendingJudgeRun = null;
    const out = await runNegotiation({
      buyerGoal: buyerGoal.trim(),
      maxRounds,
      buyerSystemPrompt: typeof buyerSystemPrompt === 'string' ? buyerSystemPrompt : undefined,
      mppInvoke,
    });
    rememberNegotiationForJudge(req, out, buyerGoal.trim());
    let judge = null;
    let judgeError = null;
    try {
      const judged = await evaluateNegotiationServerSide(req, out, {
        buyerGoal: buyerGoal.trim(),
        buyerName: typeof buyerName === 'string' ? buyerName : '',
        event_id: typeof event_id === 'string' ? event_id : undefined,
        eventId: typeof eventId === 'string' ? eventId : undefined,
      });
      if (judged.skipped) judgeError = judged.error;
      else {
        judge = judged.result;
        const pending = getPendingJudgeRun(req) || {};
        req.session.pendingJudgeRun = {
          ...pending,
          judgedAt: Date.now(),
          judgeResult: judge,
        };
      }
    } catch (e) {
      judgeError = e instanceof Error ? e.message : String(e);
    }
    await saveSession(req);
    return res.json({ ...out, judge, judgeError });
  } catch (e) {
    console.error('[negotiation]', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
