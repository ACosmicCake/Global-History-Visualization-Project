# Living Atlas data store

The data the Living Atlas engine reads, written by the Historian Agent loop in `spec.md` (a copy of the project's agent prompt; `state.json` holds its SHA-256 so agents re-read it when it changes).

| Path | What it is |
| --- | --- |
| `spec.md` | Standing instructions, sections 1–11 (`{SPEC}` in the goal) |
| `schema/RECORD_SCHEMA.md` | Record schema 1.0.0, the machine form of spec section 4 |
| `AGENT_BRIEF.md` | How one historian agent runs one pass in this repo |
| `records/<id>.json` | One file per record. Only `status: published` renders; `stub` records are invisible placeholders |
| `queue.json` | Discovery queue. Ranked by `tools/queue.mjs next`: visitor corrections, then seed list, then the spec 8 score |
| `corrections.json` | Visitor and reviewer error reports (triage queue, outranks everything) |
| `coverage_map.json` | Region × time bin × domain counts, emptiest cells, and the current 100-record balance check |
| `changelog.md` | One line per publish: `date · id · new/enriched/corrected · confidence · least-certain field` |
| `reports/` | Progress reports every 50 records; audit results every 100 |
| `inbox/` | New targets proposed by agents, ingested into the queue by `tools/ingest.mjs` |
| `datasets/` | Ambient-layer datasets (spec 6.1) with license and citation |

## Tools (Node 22; only the API runners below need `npm install` in `atlas/`)

```bash
node atlas/tools/queue.mjs next 10          # what to work on
node atlas/tools/gate.mjs <id>              # quality gate (spec 10)
node atlas/tools/review.mjs <id>            # compact view for the sceptical re-read
node atlas/tools/publish.mjs <id>           # gate + duplicate check, publish, changelog, stubs, coverage
node atlas/tools/ingest.mjs                 # inbox targets -> queue
node atlas/tools/coverage.mjs               # rebuild coverage map
node atlas/tools/commons.mjs "File:X.jpg"   # verify a Wikimedia Commons license and credit
node atlas/tools/paleo.mjs <lon> <lat> <Ma> # paleo-position via the GPlates Web Service
```

## API historian runners

Two scripts run outline and model passes without a Claude Code session, one conversation per target. They share `tools/agent-core.mjs`, where the agent's tools live. An agent can read files under `atlas/`, check for duplicates, write only its assigned record, and run the gate, spotcheck, paleo and osm-footprint tools. It has no shell. Each batch writes `inbox/<batch>.report.md`, the same as `gemini.mjs`, and every record lands as `needs_review`. The usual review and `publish.mjs` steps still decide what ships.

```bash
cd atlas && npm install                                        # once: installs @anthropic-ai/sdk (pinned)
node atlas/tools/claude-agent.mjs next c01 2 --dry             # show what would run
node atlas/tools/claude-agent.mjs next c01 2                   # the next 2 open queue targets
node atlas/tools/claude-agent.mjs outline c02 <id> <id> --effort medium
node atlas/tools/claude-agent.mjs model m01 place-dome-of-the-rock
node atlas/tools/claude-agent.mjs spend                        # estimated spend against the cap
```

- **Claude API (`claude-agent.mjs`).**
  - **Key:** reads `ANTHROPIC_API_KEY` from the environment. Never write the key into a file here.
  - **Models:** defaults to `claude-sonnet-5-5`. `--model claude-opus-5-5` costs about twice as much; an Opus trial cost about $0.74 per outline.
  - **Web access:** web search and fetch run on Anthropic's servers, with Wikipedia and the other banned sites blocked.
  - **Spending:** every response is priced from its usage and added to `api_spend.json`. A target stops at `--max-usd` (default 1.5). Nothing starts once the total would pass `cap_usd` (95 by default, below the $100 credit). These figures are estimates; the Claude Console shows the real bill.
- **Open-weight models (`oss-agent.mjs`).**
  - **Server:** works with any OpenAI-compatible server: Ollama, LM Studio, vLLM, or a hosted router such as OpenRouter.
  - **Settings:** set `OSS_BASE_URL`, `OSS_MODEL` and, for hosted routers only, `OSS_API_KEY` and the `OSS_PRICE_IN`/`OSS_PRICE_OUT` per-million-token prices. You can also copy `oss.example.json` to `oss.json`, but keep keys out of that file.
  - **Web access:** search uses DuckDuckGo's results page, or a SearXNG instance if `OSS_SEARCH_URL` is set. Fetch refuses local and private addresses at every redirect.
  - **Getting started:** run `node atlas/tools/oss-agent.mjs ping` first to confirm the model can call tools. Then start with 2–3 targets: smaller models need closer review.
  - **OpenRouter free models:** `oss.openrouter.example.json` (copied to `oss.json`) uses `nvidia/nemotron-3-ultra-550b-a55b:free` with free fallbacks. The key goes in the `OSS_API_KEY` environment variable. The free tier allows 20 requests a minute and 50 a day until the account has bought $10 of credits, then 1,000 a day. The runner waits and retries when it is rate-limited.

## 3D monument models

`model` blocks (spec 6.4; written by model agents following `atlas/MODEL_BRIEF.md`) carry sourced measurements and a `shape`. Blender turns them into meshes:

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python viewer/models/build_models.py
```

This writes `viewer/models/<id>.json` (the compact mesh the viewer loads) and `<id>.glb` (for refining in Blender by hand or through Blender MCP), plus `index.json`. Re-run it after new models are published. Records without a sourced height get no model; walls and roads are drawn as paths.
