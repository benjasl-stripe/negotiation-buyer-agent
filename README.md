# Negotiation buyer agent

Workshop lab for attendees: **buyer agent + browser UI** running locally. Connects to facilitator-deployed AWS services (seller, property dossier, judge, OpenAI proxy).

## The story

You arrive at the hackathon as a buyer's agent principal.

The property is fixed.  
The seller is live.  
The leaderboard is public.

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

Open **[http://localhost:3000](http://localhost:3000)** — **Practice chat** or **Run vs seller**.

## Stripe setup for paid tools (MPP)

If you want to use paid property tools over MPP, each attendee needs their own Stripe setup.

1. Create or use a Stripe account.
2. Add Stripe API keys to your local buyer `.env`:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_PUBLISHABLE_KEY`
3. In the buyer app (`http://localhost:3000`), open the wallet/payment section and add a payment method (card).
4. Run `npm run buyer:check` and confirm wallet/payment checks pass.

Without this setup, paid MPP tools will return `402 Payment Required` and cannot complete the paid retry flow.

## Chapter 1: First negotiation run

1. In the UI, set your **Agent name** and choose your **Competing event**.
2. In **Practice chat**:
  - chat with **Buyer agent**,
  - switch to **Seller agent**.
3. Go to **Run vs seller**:
  - write a short buyer mandate,
  - click **Save prompt**,
  - click **Run negotiation**.
4. When run ends, open **View judge** and note:
  - overall score,
  - agreed price,
  - tool calls + spend.
5. Make one improvement. then run again.

## Chapter 2: Build your toolbelt

Your agent starts with no automatic property tools wired in. That is intentional.

You choose what intelligence the buyer can access, and how that intelligence is retrieved.

Discover available tools:

```bash
npm run tools:discover
```

At this stage you have two valid playstyles:

1. **Manual investigator (fastest start):** call property endpoints yourself with `curl`, then feed findings to your buyer strategy.
2. **Agent engineer (best scale):** wire tools into the manifest so the agent fetches data automatically during negotiation.

### Option A: Manual investigator (curl)

Use this when you want to validate data paths before writing tool logic.

```bash
# Example: free or paid route depending on backend config
curl -i "https://jf04vpwzxk.execute-api.us-west-2.amazonaws.com/api/property/schools"
```

If the route is paid, you will see `402 Payment Required`. That is expected in MPP mode until a valid payment credential is provided.

### Option B: Agent engineer (manifest + runner)

Use this when you want your buyer agent to fetch evidence by itself.

1. Add selected tools to `data/tools.manifest.json`.
2. Point each tool URL to a property-service endpoint.
3. Write strong `description` triggers so the model knows when to call each tool.

Example manifest entry:

```json
  {
      "name": "property_schools",
      "description": "Starter/free tool for assignment, rezoning, and buyer demand signals.",
      "parameters": {
        "type": "object",
        "properties": {}
      },
      "http": {
        "method": "GET",
        "url": "https://jf04vpwzxk.execute-api.us-west-2.amazonaws.com/api/property/schools",
        "headers": {}
      }
    }
```

### MPP coding exercise (minimal, real flow)

All tool calls run through:

- `lib/workshop-tool-runner.js`

Your implementation target is the core loop:

1. call paid route
2. receive `402 Payment Required`
3. mint SPT from session wallet
4. retry with payment credential
5. return success data + receipt

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

Whether you stay manual (`curl`) or integrate tools into the agent, the goal is the same: turn evidence into better outcomes.

If you stay manual, bring only the strongest facts into your prompt updates.

If you integrate tools, make your tool descriptions and buyer prompt specific enough that the model calls tools at the right moment.

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
3. Tighten tool descriptions and buyer prompt (or improve your manual evidence notes).
4. Re-run and compare score, agreed price, and tool cost.


## Customization

- **Tools:** edit `data/tools.manifest.json` — see `docs/tools-manifest.md`
- **Buyer prompt:** `AGENT_SYSTEM_PROMPT` or `NEGOTIATION_BUYER_SYSTEM_PROMPT` in `.env`
- **Practice seller role-play:** set `PRACTICE_SELLER_SYSTEM_PROMPT` in `.env` (Run vs seller uses deployed seller persona)

## Scripts


| Command                  | Action                                            |
| ------------------------ | ------------------------------------------------- |
| `npm run dev`            | Start with hot reload                             |
| `npm run buyer:check`    | Validate `.env` + manifest                        |
| `npm run buyer:sync-env` | Pull deployed service URLs from AWS (optional)    |
| `npm run tools:list`     | List manifest tools                               |
| `npm run tools:discover` | List discoverable catalog tools (not enabled yet) |


