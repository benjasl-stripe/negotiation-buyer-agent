import express from 'express';
import {
  isWalletStripeConfigured,
  walletPublishableKey,
  walletSptMintMode,
  getWalletSummary,
  getWalletStatusForApi,
  createSetupIntentForSession,
  confirmSetupIntentAndSave,
  clearWalletSession,
} from '../lib/agent-wallet.js';

const router = express.Router();

router.get('/config', (_req, res) => {
  res.json({
    publishableKey: walletPublishableKey(),
    configured: isWalletStripeConfigured(),
    sptMintMode: walletSptMintMode(),
  });
});

router.get('/status', async (req, res) => {
  try {
    const wallet = await getWalletStatusForApi(req.session);
    res.json({
      ...wallet,
      stripe: isWalletStripeConfigured(),
      sptMintMode: walletSptMintMode(),
    });
  } catch (e) {
    console.error('[wallet status]', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post('/setup-intent', async (req, res) => {
  try {
    if (!isWalletStripeConfigured()) {
      const needProfile = walletSptMintMode() !== 'test_helper';
      return res.status(503).json({
        error: needProfile
          ? 'Stripe not configured — set STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, and STRIPE_PROFILE_ID on the agent.'
          : 'Stripe not configured — set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY (MPP_SPT_MINT_MODE=test_helper).',
      });
    }
    const out = await createSetupIntentForSession(req.session);
    res.json({ ...out, publishableKey: walletPublishableKey() });
  } catch (e) {
    console.error('[wallet]', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post('/confirm', async (req, res) => {
  try {
    const { setupIntentId } = req.body || {};
    if (typeof setupIntentId !== 'string' || !setupIntentId.trim()) {
      return res.status(400).json({ error: 'Body must include setupIntentId (string)' });
    }
    const wallet = await confirmSetupIntentAndSave(req.session, setupIntentId.trim());
    res.json({ ok: true, wallet });
  } catch (e) {
    console.error('[wallet]', e);
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post('/clear', (req, res) => {
  clearWalletSession(req.session);
  res.json({ ok: true, wallet: getWalletSummary(req.session) });
});

export default router;
