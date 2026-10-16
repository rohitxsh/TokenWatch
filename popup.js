import { SERVICES, getSettings, level } from './shared.js';

const cards = document.getElementById('cards');
const debugBox = document.getElementById('debug');
const busy = new Set();

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v);
  }
  n.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return n;
}

const fmtTime = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

function countdown(iso) {
  let m = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (m <= 0) return 'resetting now';
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  m %= 60;
  return 'resets in ' + (d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`);
}

function limitRow(l, svcName) {
  const p = l.percentUsed;
  const has = typeof p === 'number';
  const clamped = has ? Math.max(0, Math.min(100, p)) : 0;
  return el('div', { class: 'limit' },
    el('div', { class: 'limit-top' },
      el('span', {}, l.label),
      has ? el('span', { class: 'pct' }, `${Math.round(p)}% used`) : el('span', { class: 'muted' }, `not reported by ${svcName}`)),
    has && el('div', { class: 'track', role: 'progressbar', 'aria-label': l.label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(clamped) },
      el('div', { class: `fill ${level(p)}`, style: `width:${clamped}%` })),
    l.resetsAt && el('div', { class: 'reset' }, `Resets ${fmtTime(l.resetsAt)} · ${countdown(l.resetsAt)}`));
}

const STATE_TEXT = {
  logged_out: (s) => `Not logged in to ${s.host}.`,
  unavailable: () => 'Data unavailable.',
  parse_error: () => "Couldn't parse the response — the endpoint may have changed. Turn on Debug to see the raw JSON.",
};

function card(key, r, raw) {
  const svc = SERVICES[key];
  const refreshBtn = el('button', { type: 'button', disabled: busy.has(key), onclick: () => refresh(key) }, busy.has(key) ? 'Refreshing…' : 'Refresh');
  let body;
  if (!r) body = el('p', { class: 'muted' }, busy.has(key) ? 'Loading…' : 'No data yet.');
  else if (r.status === 'ok') body = el('div', {}, ...r.limits.map((l) => limitRow(l, svc.name)));
  else body = el('div', { class: `state ${r.status}` },
    el('p', {}, STATE_TEXT[r.status]?.(svc) ?? 'Unknown state.'),
    r.error && el('p', { class: 'muted' }, r.error),
    el('button', { type: 'button', onclick: () => chrome.tabs.create({ url: svc.url }) }, `Open ${svc.host}`));

  return el('section', { class: 'card', 'aria-label': svc.name },
    el('div', { class: 'card-head' }, el('h2', {}, svc.name), r?.plan && el('span', { class: 'plan' }, r.plan), refreshBtn),
    body,
    r && el('div', { class: 'updated' }, `Last updated ${new Date(r.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`),
    debugBox.checked && el('pre', {}, raw ? JSON.stringify(raw, null, 2) : 'No raw JSON from this browser session yet.'));
}

async function render() {
  const s = await getSettings();
  const keys = Object.keys(SERVICES).filter((k) => s.services[k]);
  const local = await chrome.storage.local.get(keys.map((k) => 'result:' + k));
  const session = await chrome.storage.session.get(keys.map((k) => 'raw:' + k));
  cards.replaceChildren(...(keys.length
    ? keys.map((k) => card(k, local['result:' + k], session['raw:' + k]))
    : [el('p', { class: 'empty' }, 'All services are disabled in Options.')]));
}

async function refresh(service, force = true) {
  const s = await getSettings();
  const targets = service ? [service] : Object.keys(SERVICES).filter((k) => s.services[k]);
  targets.forEach((k) => busy.add(k));
  render();
  try { await chrome.runtime.sendMessage({ cmd: 'refresh', service, force }); }
  finally { targets.forEach((k) => busy.delete(k)); render(); }
}

try { debugBox.checked = localStorage.getItem('debug') === '1'; } catch {}
debugBox.addEventListener('change', () => { try { localStorage.setItem('debug', debugBox.checked ? '1' : '0'); } catch {} render(); });
document.getElementById('refresh-all').addEventListener('click', () => refresh());
document.getElementById('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.storage.onChanged.addListener(() => render());
setInterval(render, 30000); // keep countdowns current

render();
refresh(undefined, false); // on open: uses cache if < 1 min old or backing off
