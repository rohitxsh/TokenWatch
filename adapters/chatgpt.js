// ChatGPT adapter: the "Plan limits" shown at chatgpt.com/settings/usage?tab=overview.
// Flow (captured 2026-10-17, numbers match that page):
//   1. GET /api/auth/session            -> { accessToken, account: { planType }, ... }  ({} when logged out)
//   2. GET /backend-api/wham/usage  with  Authorization: Bearer <accessToken>   (401 without it)
//        -> { plan_type: "plus",
//             rate_limit: { primary_window:   { used_percent, limit_window_seconds: 18000,  reset_at: <unix s> },
//                           secondary_window: { used_percent, limit_window_seconds: 604800, reset_at } }, ... }
import { getJson, failed, result, num } from './common.js';

const ORIGIN = 'https://chatgpt.com';
const HOST = 'chatgpt.com';
let token = null; // memory only, never persisted
let tokenUntil = 0;

export async function fetchUsage() {
  const raw = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token || Date.now() > tokenUntil) {
      // An empty {} means logged out, or that the worker's request carried no cookies, so the tab fallback runs.
      const s = await getJson(ORIGIN, '/api/auth/session', {}, (j) => j?.accessToken);
      if (s.json && typeof s.json === 'object') raw.session = { hasAccessToken: !!s.json.accessToken, planType: s.json.account?.planType ?? null };
      if (!s.ok && s.status === 200 && s.json) {
        return result('chatgpt', { status: 'logged_out', error: `No session on chatgpt.com.${s.noTab ? ' If you are logged in, open a chatgpt.com tab and refresh.' : ''}`, raw });
      }
      if (!s.ok) return failed('chatgpt', HOST, s, raw);
      token = s.json.accessToken;
      tokenUntil = Date.now() + 10 * 60 * 1000;
    }
    const r = await getJson(ORIGIN, '/backend-api/wham/usage', { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401 && attempt === 0) { token = null; continue; } // token expired: fetch a fresh one once
    if (!r.ok) return failed('chatgpt', HOST, r, raw);
    const { email, user_id, account_id, ...safe } = r.json || {};
    raw.usage = safe;
    const limits = parseUsage(r.json);
    if (!limits.length) return result('chatgpt', { status: 'parse_error', error: 'No rate_limit windows in /backend-api/wham/usage.', raw });
    return result('chatgpt', { plan: planName(r.json.plan_type), limits, raw });
  }
}

const planName = (p) => (typeof p === 'string' && p ? p[0].toUpperCase() + p.slice(1) : null);

function windowLabel(secs) {
  if (secs === 604800) return 'Weekly limit';
  if (!secs) return 'Limit';
  return secs < 86400 ? `${Math.round(secs / 3600)}-hour limit` : `${Math.round(secs / 86400)}-day limit`;
}

export function parseUsage(j) {
  const rl = j?.rate_limit;
  return [['primary', rl?.primary_window], ['secondary', rl?.secondary_window]]
    .filter(([, w]) => w)
    .map(([k, w]) => ({
      id: k,
      label: windowLabel(w.limit_window_seconds),
      percentUsed: num(w.used_percent),
      used: null,
      max: null,
      resetsAt: typeof w.reset_at === 'number' ? new Date(w.reset_at * 1000).toISOString() : null,
    }));
}
