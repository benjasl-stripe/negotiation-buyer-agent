# Tools manifest (`tools.manifest.json`)

Attendees add **HTTP tools** the model can call so the agent can reach their own services (quotes, catalogs, **MPP**-related endpoints, and so on). No CLI — edit JSON and restart the dev server (or `POST /api/chat/reload-manifest`).

This workshop focuses on **negotiating and agreeing a deal** plus **MPP**; there is no separate “commerce discovery” or protocol stack in this repo—only your manifest and whatever URLs you point at.

## Location

- Default: **`agent/data/tools.manifest.json`**
- Override: set **`TOOLS_MANIFEST_PATH`** in the repo root `.env` to another file.

## Shape

```json
{
  "version": 1,
  "tools": [
    {
      "name": "my_capability",
      "description": "Shown to the model — what this tool does.",
      "parameters": {
        "type": "object",
        "properties": {
          "foo": { "type": "string" }
        },
        "required": ["foo"]
      },
      "http": {
        "method": "POST",
        "url": "https://your-tool-api.example/v1/run",
        "headers": {
          "Authorization": { "env": "TOOL_API_BEARER_TOKEN" }
        }
      }
    }
  ]
}
```

### Fields

- **`name`**, **`description`**, **`parameters`** — OpenAI function-calling shape (`parameters` is JSON Schema).
- **`http.url`** — required.
- **`http.method`** — `GET` | `POST` | `PUT` | `PATCH` (default `POST`). `GET` sends tool arguments as **query parameters**.
- **`http.headers`** — map of header → string literal **or** `{ "env": "ENV_VAR" }` (read from the agent process). Use this for API keys or MPP-related auth headers your backend expects.
- **`mpp`** (boolean) — when `true`, the agent uses the **MPP client** ([mppx](https://www.npmjs.com/package/mppx)): on HTTP **402**, pay via **Stripe SPT** (Agent wallet) or **Tempo** (`TEMPO_PRIVATE_KEY`), then retry with `Authorization: Payment …`. Requires property API **`PROPERTY_GATE_MODE=mpp`**.
- **`mpp_spt`** — alias for **`mpp`** (kept for older manifests). Prefer **`mpp`**.
- **`mpp_legacy_header`** — if `true` with `mpp`/`mpp_spt`, sends **`X-Shared-Payment-Token`** instead of full MPP (for legacy `PropertyGateMode=mpp_spt` only).

### Reserved names

Set **`RESERVED_TOOL_NAMES`** (comma-separated) in `.env` to block manifest tool names if you reserve some for a future built-in.

Non-success HTTP statuses are returned to the model as a JSON object with `success: false`, `http_status`, and `error` / `response_body` as appropriate—no special-casing in the runner.

## Example

See **`agent/data/tools.manifest.example.json`**.

## CLI: list tools

From repo root (uses the same `.env` / `TOOLS_MANIFEST_PATH` as the agent):

```bash
npm run tools:list
npm run tools:list:json
```

From `agent/`: `npm run tools:list`. Options: `--json`, `--manifest /path/to/tools.manifest.json`.

### MPP on property tools

When **`property-service`** uses **`PropertyGateMode=mpp`**, each dossier `GET` returns **402** until the client completes [MPP](https://docs.stripe.com/payments/machine/mpp) payment:

- **Fiat:** Stripe **SPT** — agent **Agent wallet** tab + `STRIPE_PROFILE_ID` matching the property API seller profile.
- **Crypto:** **Tempo** — optional `TEMPO_PRIVATE_KEY` on the agent, or test with `npx mppx https://YOUR-HttpApiUrl.../api/property/schools`.

Manifest tools set **`"mpp": true`** (see `agent/data/tools.manifest.json`). The agent handles 402 → pay → retry automatically.
