# TokenWatch

Chrome extension (MV3, plain JS, no build) that shows your Claude, ChatGPT and Gemini usage limits in one popup,
using the sessions you're already logged in with. No API keys, no analytics, no remote code.

## Install (load unpacked)
1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder (the one with `manifest.json`).
4. Pin TokenWatch from the puzzle-piece menu and click it.

After editing any file, click the ↻ reload icon on the TokenWatch card in `chrome://extensions`.

## What it reads (captured 2026-10-16/17)
| Service | Requests | Auth |
|---|---|---|
| Claude | `GET /api/organizations` → picks the org with `chat` capability; plan from `claude_pro` / `claude_max`<br>`GET /api/organizations/{uuid}/usage` → `limits[]` (`kind`, `percent`, `resets_at`) | cookies only |
| ChatGPT | `GET /api/auth/session` → `accessToken` (kept in memory only, max 10 min)<br>`GET /backend-api/wham/usage` → `rate_limit.primary_window` (5-hour) / `secondary_window` (weekly): `used_percent`, `reset_at` (unix seconds) | `Authorization: Bearer <accessToken>` |
| Gemini | `GET /app` (HTML) → XSRF token `SNlM0e` (kept in memory only, max 10 min)<br>`POST /_/BardChatUi/data/batchexecute?rpcids=jSf9Qc&rt=c`, form body `f.req=[[["jSf9Qc","[]",null,"generic"]]]&at=<token>` → `[2, [[?, fractionUsed, kind (1 = current, 2 = weekly), [[resetUnixSeconds, nanos]]], …], false]` | cookies + `at` token |

Claude and ChatGPT show **5-hour limit** and **Weekly limit**. Gemini shows **Current limit** and **Weekly limit**, which are
the two bars on gemini.google.com/usage; Gemini doesn't say how long its current window is. Gemini's plan isn't shown
because it comes from a request that hasn't been captured yet. ChatGPT's numbers are the "Plan limits"
on chatgpt.com/settings/usage?tab=overview, which ChatGPT says are shared across Codex, Work, Workspace Agents and
ChatGPT for Excel. Regular chat conversations are not included.

## Permissions
- `storage`: settings and parsed results (`chrome.storage.local`); the Debug raw JSON goes in `chrome.storage.session` (memory, cleared when Chrome closes).
- `alarms`: background refresh (default 15 min, minimum 5).
- `scripting`: the fallback. When a background fetch fails (cookies not sent, Cloudflare, missing page headers), the same request is run inside an already-open tab of that site (MAIN world). The extension never opens tabs on its own. It finds the tab through `chrome.tabs.query` with a URL filter, which the host permissions already allow, so the `tabs` permission isn't needed.
- Host permissions: `https://claude.ai/*`, `https://chatgpt.com/*`, `https://gemini.google.com/*` only.

Choose which services appear in **Options → Services to show**.

## Politeness
Fetches happen when the popup opens (the cache is reused if it's under 1 minute old), when you click Refresh, and on the alarm.
Any non-OK result, including HTTP 429, backs off automatically: 5 → 10 → 20 … minutes, capped at 2 h. The manual Refresh button ignores backoff.

## Tests
`node --test tests/parsers.test.mjs`: parser tests built from the captured responses.

## Troubleshooting
- **"Not logged in"**: log in on the site (the button opens it), then press Refresh. If you *are* logged in, Chrome may not have sent your cookies to the background request. Keep a tab of the site open and press Refresh so the in-tab fallback runs.
- **401 / 403**: the session expired, or the org changed (Claude re-discovers its org on the next fetch after a 403/404). For ChatGPT, a 401 gets one automatic retry with a fresh token. If it keeps failing, reload the site tab and refresh.
- **Cloudflare challenge** ("Blocked by a Cloudflare check"): open or reload the site in a tab, complete any check, then Refresh. The in-tab fallback reuses the cleared session.
- **"Couldn't parse" / endpoint changed**:
  1. Tick **Debug** in the popup to see the raw JSON from the last fetch.
  2. Open the site's usage page with DevTools → Network → Fetch/XHR and find the new request (Claude: Settings → Usage, look for `usage`; ChatGPT: Settings → Usage, look for `wham/usage`; Gemini: Settings → Usage limits, look for `batchexecute` with `rpcids=jSf9Qc`).
  3. Edit only that service's adapter: `adapters/claude.js`, `adapters/chatgpt.js` or `adapters/gemini.js`. The URLs are at the top of `fetchUsage()`; the mapping is in `parseUsage()`. Both must return the same normalized shape.
  4. Update the sample in `tests/parsers.test.mjs`, run the tests, and reload the extension.
