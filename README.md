# Negotiation buyer agent

Workshop lab for attendees: **buyer agent + browser UI** running locally. Connects to facilitator-deployed AWS services (seller, property dossier, judge, OpenAI proxy).

## Quick start

```bash
cp .env.example .env
# Set buyer STRIPE_* keys, or run: npm run buyer:sync-env  (needs AWS CLI for deployed URLs)

npm install
npm run buyer:check
npm run dev
```

Open **http://localhost:3000** — **Practice chat** or **Run vs seller**.

## What runs where

| Component | Where |
|-----------|--------|
| This repo (buyer + UI) | Local `:3000` |
| Seller agent | AWS — `SELLER_SERVICE_URL` |
| Property dossier tools | AWS — URLs in `data/tools.manifest.json` |
| Negotiation judge | AWS — `JUDGE_SERVICE_URL` |
| OpenAI | AWS proxy — `LAMBDA_ENDPOINT` + `WORKSHOP_SECRET` |

Platform services are maintained in the separate **negotiation-platform-services** repo (facilitator only).

## Customize

- **Tools:** edit `data/tools.manifest.json` — see `docs/tools-manifest.md`
- **Buyer prompt:** `AGENT_SYSTEM_PROMPT` or `NEGOTIATION_BUYER_SYSTEM_PROMPT` in `.env`
- **Practice seller role-play:** `data/practice-seller-persona.txt` (Run vs seller uses deployed seller persona)

## Scripts

| Command | Action |
|---------|--------|
| `npm run dev` | Start with hot reload |
| `npm run buyer:check` | Validate `.env` + manifest |
| `npm run buyer:sync-env` | Pull deployed service URLs from AWS (optional) |
| `npm run tools:list` | List manifest tools |
