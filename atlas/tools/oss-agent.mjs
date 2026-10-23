// Run historian passes on an open-weight model through any OpenAI-compatible chat-completions server:
// Ollama, LM Studio, vLLM, llama.cpp server, or a hosted router such as OpenRouter, Together or DeepInfra.
// Same tools, prompts, reports and spending ledger as claude-agent.mjs; web search and fetch run here.
// Usage:
//   node atlas/tools/oss-agent.mjs outline <batch> <id> [<id> ...] [options]
//   node atlas/tools/oss-agent.mjs next <batch> <n> [options]
//   node atlas/tools/oss-agent.mjs model <batch> <id> [<id> ...] [options]
//   node atlas/tools/oss-agent.mjs ping                  check that the server answers and can call tools
//   node atlas/tools/oss-agent.mjs search "<query>" | fetch <url>   try the web tools by hand
// Configuration (environment, or atlas/oss.json with the same keys in lower case):
//   OSS_BASE_URL   default http://localhost:11434/v1 (Ollama)
//   OSS_MODEL      e.g. qwen3:32b (Ollama) or a router's model id
//   OSS_API_KEY    only for hosted routers; keep it in the environment, never in a file here
//   OSS_PRICE_IN / OSS_PRICE_OUT   US$ per million tokens, for the ledger (default 0: local)
//   OSS_SEARCH_URL optional SearXNG instance (JSON API); otherwise DuckDuckGo's HTML results page is used
//   OSS_FALLBACKS  OpenRouter only: comma-separated models to route to when the first is busy
// OpenRouter free models (ids ending in :free): 20 requests a minute, and 50 a day per account until it has bought
// $10 of credits, then 1,000 a day. An outline takes roughly 8-20 requests, so budget accordingly.
// Options: --model <id>  --max-usd 0.5  --concurrency 2  --dry
// Open models vary a lot in tool use: run `ping`, then try a batch of 2-3 targets and review them closely.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';
import { TOOL_SPECS, runTool, systemPrompt, targetPrompt, runBatch, ledger, addSpend, nextOpen, parseArgs } from './agent-core.mjs';

const file = fs.existsSync(path.join(ROOT, 'oss.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'oss.json'), 'utf8')) : {};
const conf = k => process.env[k] ?? file[k.toLowerCase()];
const { flags, pos } = parseArgs(process.argv.slice(2));
const [cmd, batch, ...rest] = pos;
const BASE = String(conf('OSS_BASE_URL') || 'http://localhost:11434/v1').replace(/\/$/, '');
const MODEL = flags.model || conf('OSS_MODEL');
const KEY = process.env.OSS_API_KEY;
const PIN = Number(conf('OSS_PRICE_IN') || 0), POUT = Number(conf('OSS_PRICE_OUT') || 0);
const maxUsd = Number(flags['max-usd'] || 0.5);
const MAX_TURNS = 60;
const UA = { 'User-Agent': 'LivingAtlas/1.0 (research tool)' };

// ---------- web tools (client side) ----------
const WEB_TOOLS = [
  { name: 'web_search', description: 'Search the web. Returns titles and URLs; results are only leads, open pages with web_fetch.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  { name: 'web_fetch', description: 'Open a web page or PDF URL and return its text (up to 15,000 characters from offset).',
    input_schema: { type: 'object', properties: { url: { type: 'string' }, offset: { type: 'integer' } }, required: ['url'], additionalProperties: false } },
];
const BLOCKED = /(^|\.)(wikipedia\.org|wikiwand\.com|baike\.baidu\.com|fandom\.com|newworldencyclopedia\.org|ancient-origins\.net|infogalactic\.com|everipedia\.org)$/i;

function publicUrl(u) {
  let url; try { url = new URL(u); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const h = url.hostname.toLowerCase();
  // no local or private addresses: the fetch tool must not reach this machine or its network
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) || h.includes(':') || h === '[::1]') return null;
  return url;
}

const htmlText = h => h.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

const web = {
  async web_search({ query }) {
    const searx = conf('OSS_SEARCH_URL');
    if (searx) {
      const r = await fetch(`${searx.replace(/\/$/, '')}/search?format=json&q=${encodeURIComponent(query)}`, { headers: UA }).then(x => x.json());
      return (r.results || []).filter(x => !BLOCKED.test(new URL(x.url).hostname)).slice(0, 10).map(x => `${x.title}\n${x.url}\n${(x.content || '').slice(0, 200)}`).join('\n\n') || 'no results';
    }
    const html = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: UA }).then(x => x.text());
    const out = [];
    for (const m of html.matchAll(/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      let href = m[1]; const uddg = href.match(/uddg=([^&]+)/); if (uddg) href = decodeURIComponent(uddg[1]);
      const url = publicUrl(href); if (!url || BLOCKED.test(url.hostname)) continue;
      out.push(`${htmlText(m[2])}\n${url.href}`);
      if (out.length >= 10) break;
    }
    return out.join('\n\n') || 'no results (try other words)';
  },
  async web_fetch({ url: u, offset = 0 }) {
    const url = publicUrl(u);
    if (!url) return 'ERROR: only public http(s) URLs can be fetched';
    if (BLOCKED.test(url.hostname)) return 'ERROR: banned source';
    let res, at = url;
    for (let hop = 0; ; hop++) { // follow redirects by hand so each hop is checked
      res = await fetch(at, { headers: UA, redirect: 'manual', signal: AbortSignal.timeout(45000) });
      if (res.status < 300 || res.status >= 400) break;
      const next = publicUrl(new URL(res.headers.get('location') || '', at).href);
      if (!next || hop >= 5) return 'ERROR: redirected to a non-public address or too many redirects';
      at = next;
    }
    if (!res.ok) return `ERROR: HTTP ${res.status}`;
    const type = res.headers.get('content-type') || '';
    if (/pdf/.test(type)) return 'This is a PDF. Check facts in it with the spotcheck tool after citing it (spotcheck converts PDFs).';
    const text = htmlText(await res.text());
    return `[${at.href}]\n` + text.slice(offset, offset + 15000) + (text.length > offset + 15000 ? `\n[... more; fetch again with offset ${offset + 15000}]` : '');
  },
};

// ---------- chat-completions loop ----------
// OSS_FALLBACKS: comma-separated model ids OpenRouter may route to when the first is busy or rate-limited
const FALLBACKS = String(conf('OSS_FALLBACKS') || '').split(',').map(s => s.trim()).filter(Boolean);
const OPENROUTER = /openrouter\.ai/.test(BASE);
// Daily request budget for free tiers (atlas/oss_usage.json, per UTC day). OSS_DAILY_REQUESTS defaults to 45 on
// OpenRouter free models (the account cap is 50 a day without credits) and is unlimited elsewhere.
const DAILY = Number(conf('OSS_DAILY_REQUESTS') || (OPENROUTER && /:free$/.test(MODEL || '') ? 45 : 0));
const USAGE = path.join(ROOT, 'oss_usage.json');
function usedToday(add = 0) {
  const day = new Date().toISOString().slice(0, 10);
  let u = {}; try { u = JSON.parse(fs.readFileSync(USAGE, 'utf8')); } catch {}
  if (u.day !== day) u = { day, requests: 0 };
  if (add) { u.requests += add; fs.writeFileSync(USAGE, JSON.stringify(u) + '\n'); }
  return u.requests;
}
class DailyCap extends Error {}
async function chat(messages, tools) {
  if (DAILY && usedToday() >= DAILY) throw new DailyCap(`daily free request budget reached (${DAILY}); try again tomorrow`);
  usedToday(1);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST', signal: AbortSignal.timeout(600000),
      headers: { 'Content-Type': 'application/json', ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
        ...(OPENROUTER ? { 'HTTP-Referer': 'https://github.com/living-atlas', 'X-Title': 'Living Atlas' } : {}) },
      body: JSON.stringify({ model: MODEL, ...(OPENROUTER && FALLBACKS.length ? { models: [MODEL, ...FALLBACKS].slice(0, 3) } : {}),
        messages, tools, tool_choice: 'auto', temperature: 0.2 }),
    });
    // free tiers rate-limit (OpenRouter: 20 requests a minute); wait as told, then retry a few times
    if ((res.status === 429 || res.status === 503) && attempt < 6) {
      const wait = Math.min(120, Number(res.headers.get('retry-after')) || 8 * 2 ** attempt);
      console.log(`  rate-limited (${res.status}); waiting ${wait}s`);
      await new Promise(r => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    if (j.error) throw new Error(`provider error: ${JSON.stringify(j.error).slice(0, 300)}`);
    return j;
  }
}

const asFn = t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } });

function runTargetFor(kind) {
  const tools = [...TOOL_SPECS, ...WEB_TOOLS].map(asFn);
  return async function runTarget(item, ctx) {
    const messages = [{ role: 'system', content: systemPrompt(kind) },
      { role: 'user', content: targetPrompt(kind, { ...item, author: `oss-${String(MODEL).replace(/[^\w.-]+/g, '-')}` }) }];
    let usd = 0;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const l = ledger();
      if (PIN + POUT > 0 && l.total_usd >= l.cap_usd) return { note: 'stopped: spending cap reached', usd, stop: 'cap' };
      let r;
      try { r = await chat(messages, tools); } catch (e) { return { note: `${e instanceof DailyCap ? '' : 'server error: '}${e.message}`, usd, stop: e instanceof DailyCap ? 'daily-cap' : 'api-error' }; }
      const u = r.usage || {}, spent = ((u.prompt_tokens || 0) * PIN + (u.completion_tokens || 0) * POUT) / 1e6;
      usd += spent; if (spent) addSpend({ id: item.id, model: MODEL, usd: spent, turn });
      const m = r.choices?.[0]?.message;
      if (!m) return { note: 'empty reply from the server', usd, stop: 'api-error' };
      messages.push({ role: 'assistant', content: m.content || '', ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) });
      if (!m.tool_calls?.length) return { note: m.content || '', usd };
      if (PIN + POUT > 0 && usd > maxUsd) return { note: `stopped at the $${maxUsd} per-target limit`, usd, stop: 'target-cap' };
      for (const c of m.tool_calls) {
        let input; try { input = JSON.parse(c.function.arguments || '{}'); } catch { input = null; }
        const out = input === null ? 'ERROR: arguments were not valid JSON; send the call again'
          : await runTool(c.function.name, input, ctx, { web_search: x => web.web_search(x).catch(e => `ERROR: ${e.message}`), web_fetch: x => web.web_fetch(x).catch(e => `ERROR: ${e.message}`) });
        messages.push({ role: 'tool', tool_call_id: c.id, content: String(out).slice(0, 30000) });
      }
    }
    return { note: `stopped after ${MAX_TURNS} turns`, usd, stop: 'turns' };
  };
}

if (cmd === 'search' || cmd === 'fetch') { // try the web tools by hand: search "<query>" | fetch <url>
  console.log((await web[`web_${cmd}`](cmd === 'search' ? { query: batch } : { url: batch })).slice(0, 1500));
  process.exit(0);
}
if (cmd === 'ping') {
  if (!MODEL) { console.error('set OSS_MODEL (or "oss_model" in atlas/oss.json)'); process.exit(1); }
  const r = await chat([{ role: 'user', content: 'Call the web_search tool with the query "Living Atlas test". Do nothing else.' }], WEB_TOOLS.map(asFn));
  const m = r.choices?.[0]?.message;
  console.log(`server ${BASE}, model ${MODEL}: ${m?.tool_calls?.length ? `tool call OK (${m.tool_calls[0].function.name} ${m.tool_calls[0].function.arguments})` : `no tool call; reply was: ${String(m?.content).slice(0, 200)}`}`);
  process.exit(0);
}
if (!['outline', 'next', 'model'].includes(cmd) || !batch) {
  console.log('commands: outline <batch> <ids...> | next <batch> <n> | model <batch> <ids...> | ping   (see the header of this file)');
  process.exit(1);
}
if (!MODEL) { console.error('set OSS_MODEL (or "oss_model" in atlas/oss.json)'); process.exit(1); }
const ids = cmd === 'next' ? await nextOpen(Number(rest[0] || 3)) : rest;
const kind = cmd === 'model' ? 'model' : 'outline';
if (!ids.length) { console.log('no targets'); process.exit(0); }
if (flags.dry) { console.log(`would run ${kind} on ${MODEL} at ${BASE}: ${ids.join(' ')}`); process.exit(0); }
await runBatch({ batch, kind, ids, label: `oss-${String(MODEL).replace(/[^\w.-]+/g, '-')}`, concurrency: Number(flags.concurrency || 2), runTarget: runTargetFor(kind) });
