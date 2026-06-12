/**
 * Lab agent — one process: static UI + OpenAI + manifest HTTP tools (deal / MPP workshop).
 */
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import chatRouter from './routes/chat.js';
import negotiationRouter from './routes/negotiation.js';
import leaderboardRouter from './routes/leaderboard.js';
import walletRouter from './routes/wallet.js';
import { getManifestToolsState } from './lib/tools-manifest.js';
import { isOpenAIConfigured, openAiMode } from './lib/openai.js';
import { isExternalSellerEnabled } from './lib/seller-client.js';
import { isJudgeServiceEnabled } from './lib/judge-client.js';
import { isWalletStripeConfigured, walletSptMintMode } from './lib/agent-wallet.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });
dotenv.config({ path: join(__dirname, '.env.local'), override: true });

const PORT = Number(process.env.AGENT_PORT || process.env.PORT) || 3000;

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(
  session({
    name: 'agentlab.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-set-SESSION_SECRET-in-production',
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 14 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(express.json({ limit: '2mb' }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.use('/api/wallet', walletRouter);
app.use('/api/chat', chatRouter);
app.use('/api/negotiation', negotiationRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use(express.static(join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  const st = getManifestToolsState();
  res.json({
    ok: true,
    openai: isOpenAIConfigured(),
    openaiMode: openAiMode(),
    manifestPath: st.path,
    tools: st.tools.map((t) => t.name),
    seller: isExternalSellerEnabled()
      ? { mode: 'remote', configured: true }
      : { mode: 'remote', configured: false, note: 'Set SELLER_SERVICE_URL for Run vs seller' },
    judge: isJudgeServiceEnabled()
      ? { configured: true, endpoint: 'POST /api/negotiation/judge' }
      : { configured: false, note: 'Set JUDGE_SERVICE_URL for auto-scoring after negotiation' },
    wallet: {
      stripe_agentic_configured: isWalletStripeConfigured(),
      spt_mint_mode: walletSptMintMode(),
    },
  });
});

app.get('/', (_req, res) => {
  res.redirect('/index.html');
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  const st = getManifestToolsState();
  console.log('');
  console.log(`  Lab agent  http://localhost:${PORT}`);
  console.log(`  UI         http://localhost:${PORT}/index.html`);
  console.log(`  Leaderboard  http://localhost:${PORT}/leaderboard.html`);
  console.log(`  Manifest   ${st.path} (${st.tools.length} tools)`);
  const aiMode = openAiMode();
  console.log(
    `  OpenAI     ${isOpenAIConfigured() ? `configured (${aiMode})` : 'NOT SET — set LAMBDA_ENDPOINT + WORKSHOP_SECRET or OPENAI_API_KEY in .env'}`
  );
  console.log(
    `  Negotiation  POST /api/negotiation/run (seller: remote — ${isExternalSellerEnabled() ? 'SELLER_SERVICE_URL set' : 'set SELLER_SERVICE_URL'})`
  );
  console.log(
    `  Judge          ${isJudgeServiceEnabled() ? 'JUDGE_SERVICE_URL set — auto-score after negotiation' : 'set JUDGE_SERVICE_URL for judge scoring'}`
  );
  console.log(
    `  Payment method  /api/wallet — SPT mint=${walletSptMintMode()} (${isWalletStripeConfigured() ? 'ready' : walletSptMintMode() === 'test_helper' ? 'set STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY' : 'set STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, MPP_SELLER_NETWORK_BUSINESS_PROFILE'})`
  );
  console.log('');
});
