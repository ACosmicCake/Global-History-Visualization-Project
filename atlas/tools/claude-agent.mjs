// Run historian passes on the Claude API (Anthropic SDK) instead of Claude Code subagents.
// Web search and web fetch run on Anthropic's servers; the atlas tools in agent-core.mjs run here.
// The coordinator still reviews, spot-checks and publishes every record.
// Usage:
//   node atlas/tools/claude-agent.mjs outline <batch> <id> [<id> ...] [options]   one conversation per target
//   node atlas/tools/claude-agent.mjs next <batch> <n> [options]                   the next n open queue targets
//   node atlas/tools/claude-agent.mjs model <batch> <id> [<id> ...] [options]     model passes on existing place records
//   node atlas/tools/claude-agent.mjs spend                                        spending so far against the cap
// Options: --model claude-sonnet-5-5 (default, the user's choice) | claude-opus-5-5 | claude-haiku-5-5
//          --effort low|medium|high (default medium)   --max-usd 1.5 (per target)   --concurrency 3   --dry
//          --fetch-tokens 15000 (cap per fetched page)   --searches 15 (web searches per target)
// Credentials: ANTHROPIC_API_KEY in the environment (or an `ant auth login` profile). Never put a key in a file here.
// Spending: every call is priced from its usage and added to atlas/api_spend.json; nothing starts once the
// ledger total plus one target's --max-usd would pass cap_usd (default 95, edit the file to change it).
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_SPECS, runTool, systemPrompt, targetPrompt, runBatch, ledger, addSpend, nextOpen, parseArgs } from './agent-core.mjs';

// US$ per million tokens (input, output, cache write 5-minute, cache read); web search $10 per 1,000 searches.
// Estimates for the cap only: check the console's usage page for the real bill.
const PRICES = {
  'claude-opus-5-5': [4, 20, 5, 0.2],
  'claude-sonnet-5-5': [2, 10, 2.5, 0.2],
  'claude-haiku-5-5': [0.1, 0.5, 0.125, 0.01],
};
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
const MAX_TURNS = 60;

function cost(model, u) {
  const [i, o, cw, cr] = PRICES[model];
  return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_creation_input_tokens || 0) * cw
    + (u.cache_read_input_tokens || 0) * cr) / 1e6 + (u.server_tool_use?.web_search_requests || 0) * 0.01;
}

const { flags, pos } = parseArgs(process.argv.slice(2));
const [cmd, batch, ...rest] = pos;
const model = flags.model || 'claude-sonnet-5-5';
const effort = flags.effort || 'medium';
const maxUsd = Number(flags['max-usd'] || 1.5);

if (cmd === 'spend') {
  const l = ledger();
  console.log(`spent about $${l.total_usd.toFixed(2)} of the $${l.cap_usd} cap over ${l.runs.length} targets`);
  for (const r of l.runs.slice(-10)) console.log(`  ${r.at.slice(0, 16)} ${r.id} ${r.model} $${r.usd}`);
  process.exit(0);
}
if (!['outline', 'next', 'model'].includes(cmd) || !batch) {
  console.log('commands: outline <batch> <ids...> | next <batch> <n> | model <batch> <ids...> | spend   (see the header of this file)');
  process.exit(1);
}
if (!PRICES[model]) { console.error(`unknown model ${model}; known: ${Object.keys(PRICES).join(', ')}`); process.exit(1); }
const ids = cmd === 'next' ? await nextOpen(Number(rest[0] || 5)) : rest;
const kind = cmd === 'model' ? 'model' : 'outline';
if (!ids.length) { console.log('no targets'); process.exit(0); }
if (flags.dry) { console.log(`would run ${kind} on ${model} (effort ${effort}, up to $${maxUsd} each): ${ids.join(' ')}`); process.exit(0); }

const client = new Anthropic({ maxRetries: 4 });
const system = [{ type: 'text', text: systemPrompt(kind), cache_control: { type: 'ephemeral' } }];
const tools = [
  ...TOOL_SPECS.map(t => ({ ...t, eager_input_streaming: true })),
  // the dynamic-filtering web tools run on Opus and Sonnet; Haiku takes the basic versions
  { type: model.includes('haiku') ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: Number(flags.searches || 15), blocked_domains: ['wikipedia.org', 'wikiwand.com', 'baike.baidu.com', 'fandom.com', 'newworldencyclopedia.org', 'ancient-origins.net', 'en-academic.com', 'academic.ru'] },
  { type: model.includes('haiku') ? 'web_fetch_20250910' : 'web_fetch_20260209', name: 'web_fetch', max_uses: 30, max_content_tokens: Number(flags['fetch-tokens'] || 15000) },
];
let useFallbacks = FALLBACK_MODELS.has(model);

async function runTarget(item, ctx) {
  const tag = model.replace('claude-', '');
  const messages = [{ role: 'user', content: targetPrompt(kind, { ...item, author: `claude-api-${tag}` }) }];
  let usd = 0, jsonRetries = 0;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const l = ledger();
    if (turn === 0 && l.total_usd + maxUsd > l.cap_usd) return { note: 'not started: the spending cap would be passed', usd, stop: 'cap' };
    if (l.total_usd >= l.cap_usd) return { note: 'stopped: spending cap reached', usd, stop: 'cap' };
    const params = {
      model, max_tokens: 64000, system, tools, messages,
      thinking: { type: 'adaptive' }, output_config: { effort },
      cache_control: { type: 'ephemeral' },
      ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    };
    let msg;
    try { msg = await client.beta.messages.stream(params).finalMessage(); jsonRetries = 0; }
    catch (e) {
      if (e instanceof Anthropic.BadRequestError && useFallbacks && /fallback/i.test(e.message)) { useFallbacks = false; turn--; continue; }
      if (e instanceof Anthropic.AuthenticationError) throw new Error('no valid API key: set ANTHROPIC_API_KEY');
      if (e instanceof Anthropic.APIError) return { note: `API error ${e.status}: ${e.message}`, usd, stop: 'api-error' };
      if (jsonRetries++ < 2) continue; // a streamed tool input that could not be parsed: re-issue the turn
      throw e;
    }
    const spent = cost(model, msg.usage); usd += spent;
    const u = msg.usage;
    addSpend({ id: item.id, model, usd: spent, turn, tokens: { in: u.input_tokens, out: u.output_tokens, cache_write: u.cache_creation_input_tokens || 0, cache_read: u.cache_read_input_tokens || 0, searches: u.server_tool_use?.web_search_requests || 0 } });
    messages.push({ role: 'assistant', content: msg.content });
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (msg.stop_reason === 'refusal') return { note: `declined (${msg.stop_details?.category || 'no category'})`, usd, stop: 'refusal' };
    if (msg.stop_reason === 'pause_turn') continue; // server-side tools paused; resend to resume
    const calls = msg.content.filter(b => b.type === 'tool_use');
    if (msg.stop_reason === 'max_tokens') return { note: 'response hit max_tokens', usd, stop: 'max_tokens' };
    if (!calls.length) return { note: text, usd };
    if (usd > maxUsd) return { note: `${text}\n(stopped at the $${maxUsd} per-target limit)`, usd, stop: 'target-cap' };
    const results = [];
    for (const c of calls) results.push({ type: 'tool_result', tool_use_id: c.id, content: String(await runTool(c.name, c.input, ctx)).slice(0, 30000) });
    messages.push({ role: 'user', content: results });
  }
  return { note: `stopped after ${MAX_TURNS} turns`, usd, stop: 'turns' };
}

await runBatch({ batch, kind, ids, label: `claude-api-${model.replace('claude-', '')}`, concurrency: Number(flags.concurrency || 3), runTarget });
