import { getSettings, MIN_INTERVAL, SERVICES } from './shared.js';

const $ = (id) => document.getElementById(id);
const s = await getSettings();
$('background').checked = s.background;
$('intervalMin').value = s.intervalMin;
$('badge').checked = s.badge;
for (const [key, svc] of Object.entries(SERVICES)) {
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', id: 'svc-' + key, checked: s.services[key] });
  const label = document.createElement('label');
  label.append(box, ` ${svc.name} (${svc.host})`);
  $('services').append(label);
}

async function save() {
  const interval = Math.max(MIN_INTERVAL, Math.round(Number($('intervalMin').value) || 15));
  $('intervalMin').value = interval;
  await chrome.storage.local.set({
    settings: {
      background: $('background').checked,
      intervalMin: interval,
      badge: $('badge').checked,
      services: Object.fromEntries(Object.keys(SERVICES).map((k) => [k, $('svc-' + k).checked])),
    },
  });
  $('status').textContent = 'Saved.';
}

document.querySelectorAll('input').forEach((i) => i.addEventListener('change', save));
