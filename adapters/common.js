// Fetch helpers shared by the adapters.

// Request origin+path as JSON (GET unless `init` says otherwise). Tries the service worker first; if that fails for any
// reason (SameSite cookies, Cloudflare, missing page headers), re-runs the same
// fetch inside an already-open tab of that site (MAIN world). Never opens tabs.
// `valid(json)` lets a caller treat a 200 as a failure (e.g. a session response without a token).
export async function getJson(origin, path, init = {}, valid = () => true) {
  let res;
  try {
    const r = await fetch(origin + path, { ...init, credentials: 'include' });
    res = check(toRes(r.status, r.headers.get('content-type'), await r.text()), valid);
  } catch (e) {
    res = { status: 0, ok: false, error: String(e?.message || e) };
  }
  if (res.ok) return res;

  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: origin + '/*', discarded: false }); } catch {}
  for (const tab of tabs) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [path, init],
        func: async (p, i) => {
          try {
            const r = await fetch(p, { ...i, credentials: 'include' });
            return { status: r.status, type: r.headers.get('content-type'), text: await r.text() };
          } catch (e) {
            return { status: 0, error: String(e) };
          }
        },
      });
      if (result.status) return { ...check(toRes(result.status, result.type, result.text), valid), viaTab: true };
    } catch {} // tab still loading, crashed, or on an error page: try the next one
  }
  return { ...res, noTab: !tabs.length };
}

const check = (res, valid) => ({ ...res, ok: res.ok && !!valid(res.json) });

export function toRes(status, type, text) {
  let json;
  if (/json/i.test(type || '')) try { json = JSON.parse(text); } catch {}
  return {
    status,
    json,
    ok: status >= 200 && status < 300 && json !== undefined,
    cloudflare: json === undefined && /cf-chl|challenge-platform|Just a moment/i.test(text || ''),
  };
}

export function result(service, fields) {
  return { service, plan: null, limits: [], fetchedAt: new Date().toISOString(), status: 'ok', error: null, ...fields };
}

// Turn a failed getJson() response into a normalized result.
export function failed(service, host, r, raw) {
  const hint = r.noTab ? ` Open a ${host} tab, then refresh.` : '';
  const out = (status, error) => result(service, { status, error, raw });
  if (r.cloudflare) return out('unavailable', `Blocked by a Cloudflare check.${hint || ` Reload your ${host} tab, complete any check, then refresh.`}`);
  if (r.status === 401 || r.status === 403) return out('logged_out', `HTTP ${r.status} from ${host}.${hint}`);
  if (r.status === 429) return out('unavailable', `Rate limited by ${host} (HTTP 429). Backing off.`);
  if (r.status === 0) return out('unavailable', `Network error: ${r.error}.${hint}`);
  if (r.status >= 200 && r.status < 300) return out('parse_error', `${host} returned a non-JSON response.`);
  return out('unavailable', `HTTP ${r.status} from ${host}.${hint}`);
}

export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const isoOrNull = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
