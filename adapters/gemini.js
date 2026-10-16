// Gemini adapter: the limits shown at gemini.google.com/usage.
// Flow (captured 2026-10-17, numbers match that page; cookies only):
//   1. GET /app  (HTML)  -> XSRF token from  "SNlM0e":"<token>"  (absent when signed out)
//   2. POST /_/BardChatUi/data/batchexecute?rpcids=jSf9Qc&rt=c
//        body: f.req=[[["jSf9Qc","[]",null,"generic"]]]&at=<token>    (400 without `at`)
//      Response is Google's ")]}'" framed format; the payload is the JSON string in ["wrb.fr","jSf9Qc","<payload>", ...]:
//        [2, [[41465, 0.14299671, 2, [[1792696109, 536930000]]],    <- [?, fraction used, 2 = weekly,  [[reset unix s, nanos]]]
//             [2213,  0.08,       1, [[1792188509, 536830000]]]],   <- [?, fraction used, 1 = current, ...]
//         false]
// The plan pill ("PRO") comes from a request not captured yet, so plan stays null.
import { getJson, failed, result, num } from './common.js';

const ORIGIN = 'https://gemini.google.com';
const HOST = 'gemini.google.com';
const RPC = 'jSf9Qc';
let xsrf = null; // memory only, never persisted
let xsrfUntil = 0;

export async function fetchUsage() {
  const raw = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!xsrf || Date.now() > xsrfUntil) {
      const page = await getJson(ORIGIN, '/app', {}, (t) => t, (text) => text.match(/"SNlM0e":"([^"]+)"/)?.[1] ?? null);
      if (!page.ok && page.status === 200) {
        return result('gemini', { status: 'logged_out', error: `Not signed in to Gemini.${page.noTab ? ' If you are signed in, open a gemini.google.com tab and refresh.' : ''}`, raw });
      }
      if (!page.ok) return failed('gemini', HOST, page, raw);
      xsrf = page.json;
      xsrfUntil = Date.now() + 10 * 60 * 1000;
    }
    const r = await getJson(ORIGIN, `/_/BardChatUi/data/batchexecute?rpcids=${RPC}&rt=c`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ 'f.req': JSON.stringify([[[RPC, '[]', null, 'generic']]]), at: xsrf }).toString(),
    }, () => true, unwrapRpc);
    if ((r.status === 400 || r.status === 401) && attempt === 0) { xsrf = null; continue; } // stale token: fetch a fresh one once
    if (!r.ok) return failed('gemini', HOST, r, raw);
    raw.usage = r.json;
    const limits = parseUsage(r.json);
    if (!limits.length) return result('gemini', { status: 'parse_error', error: `No limits in ${RPC} response.`, raw });
    return result('gemini', { limits, raw });
  }
}

// Pull the payload for RPC out of the ")]}'" framed batchexecute body.
export function unwrapRpc(text) {
  for (const line of text.split('\n')) {
    if (!line.startsWith('[')) continue;
    let rows;
    try { rows = JSON.parse(line); } catch { continue; }
    const hit = Array.isArray(rows) && rows.find((x) => Array.isArray(x) && x[0] === 'wrb.fr' && x[1] === RPC);
    if (hit) return typeof hit[2] === 'string' ? JSON.parse(hit[2]) : undefined;
  }
  return undefined;
}

const LABELS = { 1: 'Current limit', 2: 'Weekly limit' };

export function parseUsage(payload) {
  const rows = Array.isArray(payload?.[1]) ? payload[1] : [];
  return rows
    .filter((x) => Array.isArray(x) && typeof x[1] === 'number')
    .sort((a, b) => a[2] - b[2])
    .map((x) => {
      const secs = x[3]?.[0]?.[0];
      return {
        id: 'kind_' + x[2],
        label: LABELS[x[2]] || `Limit ${x[2]}`,
        percentUsed: num(Math.round(x[1] * 1000) / 10),
        used: null,
        max: null,
        resetsAt: typeof secs === 'number' ? new Date(secs * 1000).toISOString() : null,
      };
    });
}
