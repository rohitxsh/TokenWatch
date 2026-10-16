// Run: node --test tests/
// Samples are trimmed copies of real responses captured 2026-10-16.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage as parseClaude, pickOrg } from '../adapters/claude.js';
import { parseUsage as parseChatgpt } from '../adapters/chatgpt.js';
import { parseUsage as parseGemini, unwrapRpc } from '../adapters/gemini.js';
import { toRes } from '../adapters/common.js';

test('claude: limits[] array', () => {
  const limits = parseClaude({
    five_hour: { utilization: 11, resets_at: '2026-10-16T19:00:00.356917+00:00' },
    seven_day_opus: null,
    limits: [
      { kind: 'session', group: 'session', percent: 11, severity: 'normal', resets_at: '2026-10-16T19:00:00.356917+00:00', scope: null, is_active: true },
      { kind: 'weekly_all', group: 'weekly', percent: 5, severity: 'normal', resets_at: '2026-10-20T23:00:00.356936+00:00', scope: null, is_active: false },
    ],
  });
  assert.deepEqual(limits, [
    { id: 'session', label: '5-hour limit', percentUsed: 11, used: null, max: null, resetsAt: '2026-10-16T19:00:00.356Z' },
    { id: 'weekly_all', label: 'Weekly limit', percentUsed: 5, used: null, max: null, resetsAt: '2026-10-20T23:00:00.356Z' },
  ]);
});

test('claude: falls back to top-level windows, ignores nulls', () => {
  const limits = parseClaude({ five_hour: { utilization: 40, resets_at: null }, seven_day: { utilization: 3, resets_at: '2026-10-20T23:00:00Z' }, seven_day_opus: null });
  assert.deepEqual(limits.map((l) => [l.id, l.percentUsed]), [['five_hour', 40], ['seven_day', 3]]);
  assert.deepEqual(parseClaude({ limits: [], tangelo: null }), []);
});

test('claude: org + plan', () => {
  assert.deepEqual(pickOrg([{ uuid: 'a', capabilities: ['api'] }, { uuid: 'b', capabilities: ['chat', 'claude_pro'] }]), { uuid: 'b', plan: 'Pro' });
  assert.equal(pickOrg([{ uuid: 'c', capabilities: ['chat', 'claude_max'] }]).plan, 'Max');
  assert.equal(pickOrg({ error: 'x' }), null);
});

test('chatgpt: wham usage (Plan limits page)', () => {
  const limits = parseChatgpt({
    plan_type: 'plus',
    rate_limit: {
      allowed: false, limit_reached: true,
      primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_after_seconds: 2975, reset_at: 1792178503 },
      secondary_window: { used_percent: 26, limit_window_seconds: 604800, reset_after_seconds: 509119, reset_at: 1792684646 },
    },
  });
  assert.deepEqual(limits.map((l) => [l.id, l.label, l.percentUsed]), [
    ['primary', '5-hour limit', 100],
    ['secondary', 'Weekly limit', 26],
  ]);
  assert.equal(limits[0].resetsAt, new Date(1792178503000).toISOString());
  assert.deepEqual(parseChatgpt({ rate_limit: null }), []);
});

test('gemini: batchexecute jSf9Qc', () => {
  const body = ")]}'\n\n202\n" + JSON.stringify([
    ['wrb.fr', 'jSf9Qc', '[2,[[41465,0.14299671,2,[[1792696109,536930000]]],[2213,0.08,1,[[1792188509,536830000]]]],false]', null, null, null, 'generic'],
    ['di', 136], ['af.httprm', 135, '0', 11],
  ]) + '\n25\n[["e",4,null,null,143]]\n';
  const limits = parseGemini(unwrapRpc(body));
  assert.deepEqual(limits.map((l) => [l.id, l.label, l.percentUsed]), [
    ['kind_1', 'Current limit', 8],
    ['kind_2', 'Weekly limit', 14.3],
  ]);
  assert.equal(limits[0].resetsAt, new Date(1792188509000).toISOString());
  assert.equal(unwrapRpc(")]}'\n\n25\n[[\"e\",4,null,null,143]]\n"), undefined);
  assert.deepEqual(parseGemini(undefined), []);
});

test('common: toRes detects JSON and Cloudflare', () => {
  assert.equal(toRes(200, 'application/json', '{"a":1}').ok, true);
  assert.equal(toRes(403, 'text/html', '<title>Just a moment...</title>').cloudflare, true);
  assert.equal(toRes(200, 'text/html', '<html>').ok, false);
  assert.equal(toRes(200, 'text/html', '<x>"SNlM0e":"tok"</x>', (t) => t.match(/"SNlM0e":"([^"]+)"/)?.[1] ?? null).json, 'tok');
});
