import express from 'express';
import { isJudgeServiceEnabled, remoteLeaderboardGet, remoteLeaderboardList } from '../lib/judge-client.js';

const router = express.Router();

router.get('/', async (_req, res) => {
  if (!isJudgeServiceEnabled()) {
    return res.status(503).json({
      error: 'JUDGE_SERVICE_URL is not set — leaderboard is stored on the judge service DynamoDB table',
    });
  }
  try {
    const data = await remoteLeaderboardList();
    return res.json(data);
  } catch (e) {
    console.error('[leaderboard list]', e);
    return res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get('/:entryId', async (req, res) => {
  if (!isJudgeServiceEnabled()) {
    return res.status(503).json({ error: 'JUDGE_SERVICE_URL is not set' });
  }
  try {
    const data = await remoteLeaderboardGet(req.params.entryId);
    return res.json(data);
  } catch (e) {
    console.error('[leaderboard get]', e);
    const msg = e instanceof Error ? e.message : String(e);
    const status = /not found|404/i.test(msg) ? 404 : 502;
    return res.status(status).json({ error: msg });
  }
});

export default router;
