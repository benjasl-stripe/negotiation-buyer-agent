# Negotiation buyer agent

Workshop lab for attendees: **buyer agent + browser UI** running locally. Connects to facilitator-deployed AWS services (seller, property dossier, judge, OpenAI proxy).

## The story

You arrive at the hackathon as a buyer's agent principal.

The property is fixed.  
The seller is live.  
The leaderboard is public.

You start with a local buyer app. You shape the agent, select tools, run negotiations, review judge feedback, and iterate until your agent can close strong deals with efficient spend.

## 3-step attendee flow

### Step 1: Deploy + configure with your Stripe account

```bash
git clone https://github.com/benjasl-stripe/negotiation-buyer-agent.git
cd negotiation-buyer-agent
cp .env.example .env
npm install
```

In `.env`, configure your workshop endpoints and Stripe keys:

- `LAMBDA_ENDPOINT`, `WORKSHOP_SECRET`
- `SELLER_SERVICE_URL`
- `JUDGE_SERVICE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`

Then validate and run:

```bash
npm run buyer:check
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)**.

### Step 2: Practice chat + first negotiation

1. Set your **Agent name** and choose your **Competing event**.
2. In **Practice chat**, talk to:
  - **Buyer agent**
  - **Seller agent**
3. Go to **Run vs seller**:
  - write your buyer mandate,
  - click **Save prompt**,
  - click **Run**.
4. Open **View judge** and review:
  - score,
  - agreed price,
  - tool spend.

### Step 3: Add tools + payment, then run again

Use tools to supercharge your buyer agent:

```bash
npm run tools:discover
```

Then:

1. Add tool entries to `data/tools.manifest.json`.
2. Add a payment method in the app wallet (Stripe test card: `4242 4242 4242 4242`).
3. Test tools in **Practice chat** with your buyer agent.
4. Tune your buyer mandate and run another negotiation.

Paid tools require a valid wallet setup; otherwise they return `402 Payment Required`.

## Reference: toolbelt patterns

Use this as a reference while doing Step 3.

Two valid playstyles:

1. **Manual investigator (fastest start):** call property endpoints with `curl`, then feed findings into strategy.
2. **Agent engineer (best scale):** wire tools into the manifest so the buyer agent fetches evidence automatically.

### Pattern A: Manual investigator (curl)

Use this when you want to validate data paths before writing tool logic.

```bash
# Example: free or paid route depending on backend config
curl -i "https://jf04vpwzxk.execute-api.us-west-2.amazonaws.com/api/property/schools"
```

If the route is pay-per-use, you will see `402 Payment Required`. That is expected in MPP mode until a valid payment credential is provided.

### Pattern B: Agent engineer (manifest + runner)

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

## Prompt + negotiation strategy deep dive

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


