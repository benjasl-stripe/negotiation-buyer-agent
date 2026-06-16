# Negotiation buyer agent

Workshop lab for attendees: **buyer agent + browser UI** running locally. Connects to facilitator-deployed AWS services (seller, property dossier, judge, OpenAI proxy).

## The story

You arrive at the hackathon as a buyer's agent principal.

The property is fixed.  
The seller is live.  
The leaderboard is public.

Your edge is not "call every tool." Your edge is judgment: buy the right evidence, at the right time, and turn it into leverage.

You start with a local buyer app. You shape the agent, select tools, run negotiations, review judge feedback, and iterate until your agent can close strong deals with efficient spend.

## Your first 30 minutes

Your mission:

1. Boot the app locally.
2. Meet your buyer and seller in practice chat.
3. Run your first scored negotiation.
4. Read the judge's verdict (score, agreed price, spend).
5. Improve and run again.

## Quick start

```bash
git clone <YOUR_BUYER_REPO_URL>
cd negotiation-buyer-agent

cp .env.example .env
# Option A: run `npm run buyer:sync-env` (pull facilitator URLs; needs AWS CLI access)
# Option B: set .env values manually from facilitator handout

npm install
npm run buyer:check
npm run dev
```

Open **http://localhost:3000** — **Practice chat** or **Run vs seller**.

## Chapter 1: First negotiation run

1. In the UI, set your **Agent name** and choose your **Competing event**.
2. In **Practice chat**:
   - chat with **Buyer agent** once,
   - switch to **Seller agent** once.
3. Go to **Run vs seller**:
   - write a short buyer mandate,
   - click **Save prompt**,
   - click **Run negotiation**.
4. When run ends, open **View judge** and note:
   - overall score,
   - agreed price,
   - tool calls + spend.
5. Make one improvement (tool description or prompt), then run again.

## Tool discovery (the ecosystem piece)

Short answer: **yes** — there are common patterns.

- **MCP (Model Context Protocol)**: emerging standard for agent tool discovery and invocation.  
  Agents can list available tools dynamically from an MCP server.
- **OpenAPI**: standard API description for HTTP services.  
  Great for docs/client generation, but agents usually still need a tool wrapper.
- **Manifest schemas** (like this repo): practical, explicit function/tool list for one app.

### What this hackathon uses

In this repo, attendees discover/use tools via:

- `data/tools.manifest.json` (source of truth for enabled tools)
- `data/tools.catalog.json` (discoverable catalog; not auto-enabled)
- `npm run tools:list` (quick visibility)
- `npm run tools:discover` (browse catalog options)
- `POST /api/chat/reload-manifest` (refresh after edits)
- `GET /api/chat/meta` (runtime view of loaded tool names)

So while MCP is the bigger ecosystem direction, your hands-on workflow here is manifest-driven by design (easy to edit, easy to reason about, fast to iterate).

## Chapter 2: Build your toolbelt

Your agent starts with no automatic property tools wired in.

That is intentional.

You decide what intelligence your agent is allowed to buy.

Your goal is to turn a basic negotiator into a sharp, evidence-driven closer.

### Your quest

1. Add tools in `data/tools.manifest.json`
2. Point each one at the property-service endpoint
3. Mark paid tools with `"mpp": true` (leave free tools without `mpp`)
4. Teach your agent when to use each tool (great `description` text helps)
5. Win on outcome **and** ROI

Discover available starter tools with:

```bash
npm run tools:discover
```

Then choose tools from `data/tools.catalog.json` and manually create manifest entries in `data/tools.manifest.json`.

By default, `property_schools` is the recommended **free starter tool** (no MPP fields).

### Endpoint map (replace `<PROPERTY_API_BASE>`)

- `.../api/property/disclosure`
- `.../api/property/hoa`
- `.../api/property/title-preliminary`
- `.../api/property/inspection`
- `.../api/property/tax-history`
- `.../api/property/flood-hazard`
- `.../api/property/comparable-sales`
- `.../api/property/schools`
- `.../api/property/utilities-energy`
- `.../api/property/permits-renovations`

### Copy/paste starter tool

```json
{
  "name": "property_inspection_report",
  "description": "Retrieve inspection findings and repair estimates. Use when condition, repairs, credits, or immediate safety issues are discussed.",
  "parameters": {
    "type": "object",
    "properties": {}
  },
  "http": {
    "method": "GET",
    "url": "<PROPERTY_API_BASE>/api/property/inspection",
    "headers": {}
  },
  "mpp": true
}
```

### Early-win checklist

1. Restart app (or reload manifest) after edits.
2. Run `npm run tools:list` and make sure your tools appear.
3. Do one run and verify buyer activity shows actual tool calls.
4. Confirm calls return HTTP 200 and your buyer cites the evidence (free + paid).
5. Compare score + spend on leaderboard, then iterate.

### How winners usually play

- More tools != better score.
- Strong evidence + clean citations + good timing = points.
- Leverage per dollar matters.
- Fabricated/uncited claims get punished hard.

## Chapter 3: Supercharge your agent

Give your agent the evidence it needs to make informed decisions and sharper negotiations.

### Evidence playbook

- Start broad once, then go targeted. Pull key reports early, then only call follow-up tools that answer open questions.
- Build a multi-source case. Best leverage usually combines inspection + comps + disclosure (not just one fact repeated).
- Turn facts into pricing logic. Every offer should be tied to concrete numbers (repair bands, comps, fees, risk costs).
- Cite like an auditor. Mention tool name + section + specific figure so claims are credible and judge-friendly.
- Stop buying when marginal value drops. Extra calls without new leverage hurt ROI and score.

### Prompting tips that work

- In each tool description, include a clear "use when..." trigger.
- Tell the buyer agent to prefer unresolved-risk tools before making major concessions.
- Instruct the agent to summarize "what changed my price" after each evidence-heavy turn.
- Add a hard rule: no property-specific claims without citations from retrieved tools.

### Fast iteration loop

1. Run one negotiation.
2. Inspect tool timeline + spend + final transcript.
3. Tighten tool descriptions and buyer prompt.
4. Re-run and compare score, agreed price, and tool cost.

## What runs where

| Component | Where |
|-----------|--------|
| This repo (buyer + UI) | Local `:3000` |
| Seller agent | AWS — `SELLER_SERVICE_URL` |
| Property dossier tools | AWS — URLs in `data/tools.manifest.json` |
| Negotiation judge | AWS — `JUDGE_SERVICE_URL` |
| OpenAI | AWS proxy — `LAMBDA_ENDPOINT` + `WORKSHOP_SECRET` |

Platform services are maintained in the separate **negotiation-platform-services** repo (facilitator only).

## Customization

- **Tools:** edit `data/tools.manifest.json` — see `docs/tools-manifest.md`
- **Buyer prompt:** `AGENT_SYSTEM_PROMPT` or `NEGOTIATION_BUYER_SYSTEM_PROMPT` in `.env`
- **Practice seller role-play:** set `PRACTICE_SELLER_SYSTEM_PROMPT` in `.env` (Run vs seller uses deployed seller persona)

## Scripts

| Command | Action |
|---------|--------|
| `npm run dev` | Start with hot reload |
| `npm run buyer:check` | Validate `.env` + manifest |
| `npm run buyer:sync-env` | Pull deployed service URLs from AWS (optional) |
| `npm run tools:list` | List manifest tools |
| `npm run tools:discover` | List discoverable catalog tools (not enabled yet) |
