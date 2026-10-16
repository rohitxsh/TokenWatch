// Claude adapter.
// Flow (captured 2026-10-16 from claude.ai/settings/usage, cookies only, no extra headers):
//   1. GET /api/organizations            -> [{ uuid, capabilities: ["chat","claude_pro"], ... }]
//   2. GET /api/organizations/{uuid}/usage
//        -> { limits: [{ kind:"session", group, percent, severity, resets_at, scope, is_active }, ...],
//             five_hour: { utilization, resets_at }, seven_day: {...}, seven_day_opus: null, ... }
import { getJson, failed, result, num, isoOrNull } from './common.js';

const ORIGIN = 'https://claude.ai';
const HOST = 'claude.ai';
let org = null; // { uuid, plan } kept in memory only

export async function fetchUsage() {
  const raw = {};
  if (!org) {
    const r = await getJson(ORIGIN, '/api/organizations');
    if (!r.ok) return failed('claude', HOST, r, raw);
    raw.organizations = Array.isArray(r.json)
      ? r.json.map((o) => ({ capabilities: o.capabilities, rate_limit_tier: o.rate_limit_tier }))
      : r.json;
    org = pickOrg(r.json);
    if (!org) return result('claude', { status: 'parse_error', error: 'No chat organization found in /api/organizations.', raw });
  }

  const r = await getJson(ORIGIN, `/api/organizations/${org.uuid}/usage`);
  if (!r.ok) {
    if (r.status === 403 || r.status === 404) org = null; // org may have changed; re-discover next time
    return failed('claude', HOST, r, raw);
  }
  raw.usage = r.json;
  const limits = parseUsage(r.json);
  if (!limits.length) return result('claude', { plan: org.plan, status: 'parse_error', error: 'No limits found in /usage response.', raw });
  return result('claude', { plan: org.plan, limits, raw });
}

export function pickOrg(orgs) {
  if (!Array.isArray(orgs)) return null;
  const chat = orgs.filter((o) => o?.uuid && o.capabilities?.includes('chat'));
  const o = chat.find((x) => x.capabilities.some((c) => /^claude_(max|pro)$/.test(c))) || chat[0];
  if (!o) return null;
  const plan = o.capabilities.includes('claude_max') ? 'Max' : o.capabilities.includes('claude_pro') ? 'Pro' : null;
  return { uuid: o.uuid, plan };
}

const LABELS = { session: '5-hour limit', weekly_all: 'Weekly limit' };
const titleCase = (s) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function parseUsage(u) {
  if (Array.isArray(u?.limits) && u.limits.length) {
    return u.limits.map((l) => ({
      id: l.kind + (typeof l.scope === 'string' ? ':' + l.scope : ''),
      label: (LABELS[l.kind] || titleCase(String(l.kind))) + (typeof l.scope === 'string' ? ` (${l.scope})` : ''),
      percentUsed: num(l.percent),
      used: null,
      max: null,
      resetsAt: isoOrNull(l.resets_at),
    }));
  }
  // Older shape: top-level windows like five_hour / seven_day / seven_day_opus with { utilization, resets_at }.
  return Object.entries(u || {})
    .filter(([, v]) => v && typeof v.utilization === 'number')
    .map(([k, v]) => ({ id: k, label: titleCase(k), percentUsed: v.utilization, used: null, max: null, resetsAt: isoOrNull(v.resets_at) }));
}
