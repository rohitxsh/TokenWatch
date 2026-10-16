import * as claude from './adapters/claude.js';
import * as chatgpt from './adapters/chatgpt.js';
import * as gemini from './adapters/gemini.js';
import { getSettings, level, COLORS, MIN_INTERVAL } from './shared.js';

const ADAPTERS = { claude, chatgpt, gemini };
const FRESH_MS = 60 * 1000; // popup reopened within a minute reuses the cache
const inflight = {};

// Storage: chrome.storage.local  "result:<svc>"  parsed result (no tokens, no raw JSON)
//                                "backoff:<svc>" { n, until }
//          chrome.storage.session "raw:<svc>"    sanitized raw JSON for the Debug view (cleared on browser exit)
function refresh(service, force) {
  return (inflight[service] ??= (async () => {
    try { return await run(service, force); } finally { delete inflight[service]; }
  })());
}

async function run(service, force) {
  const rKey = 'result:' + service, bKey = 'backoff:' + service;
  const { [rKey]: prev, [bKey]: backoff } = await chrome.storage.local.get([rKey, bKey]);
  if (!force) {
    if (backoff && Date.now() < backoff.until) return;
    if (prev && Date.now() - Date.parse(prev.fetchedAt) < FRESH_MS) return;
  }

  let res;
  try {
    res = await ADAPTERS[service].fetchUsage();
  } catch (e) {
    res = { service, plan: null, limits: [], fetchedAt: new Date().toISOString(), status: 'unavailable', error: String(e?.message || e) };
  }
  const { raw = null, ...clean } = res;

  // Back off on errors and 429: 5, 10, 20 … minutes, capped at 2 hours (logged-out included).
  const failing = clean.status !== 'ok';
  const n = failing ? (backoff?.n || 0) + 1 : 0;
  const until = failing ? Date.now() + Math.min(MIN_INTERVAL * 60e3 * 2 ** (n - 1), 2 * 3600e3) : 0;

  await chrome.storage.session.set({ ['raw:' + service]: raw });
  await chrome.storage.local.set({ [rKey]: clean, [bKey]: { n, until } });
  await updateBadge();
}

async function refreshAll(force) {
  const s = await getSettings();
  await Promise.all(Object.keys(ADAPTERS).filter((k) => s.services[k]).map((k) => refresh(k, force)));
}

async function updateBadge() {
  const s = await getSettings();
  const keys = Object.keys(ADAPTERS).filter((k) => s.services[k]).map((k) => 'result:' + k);
  const stored = s.badge ? await chrome.storage.local.get(keys) : {};
  const pcts = Object.values(stored)
    .filter((r) => r.status === 'ok')
    .flatMap((r) => r.limits.map((l) => l.percentUsed))
    .filter((p) => typeof p === 'number');
  if (!pcts.length) return chrome.action.setBadgeText({ text: '' });
  const max = Math.round(Math.max(...pcts));
  await chrome.action.setBadgeText({ text: max + '%' });
  await chrome.action.setBadgeBackgroundColor({ color: COLORS[level(max)] });
  await chrome.action.setBadgeTextColor({ color: '#ffffff' });
}

async function schedule() {
  const s = await getSettings();
  if (s.background) await chrome.alarms.create('refresh', { periodInMinutes: Math.max(MIN_INTERVAL, Number(s.intervalMin) || 15) });
  else await chrome.alarms.clear('refresh');
}

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener((a) => a.name === 'refresh' && refreshAll(false));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) { schedule(); updateBadge(); }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.cmd !== 'refresh') return;
  (async () => {
    try {
      await (msg.service ? refresh(msg.service, !!msg.force) : refreshAll(!!msg.force));
      sendResponse(true);
    } catch {
      sendResponse(false);
    }
  })();
  return true; // async response
});
