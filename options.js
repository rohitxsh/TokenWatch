import { getSettings, MIN_INTERVAL } from './shared.js';

const $ = (id) => document.getElementById(id);
const s = await getSettings();
$('background').checked = s.background;
$('intervalMin').value = s.intervalMin;
$('badge').checked = s.badge;
$('svc-claude').checked = s.services.claude;
$('svc-chatgpt').checked = s.services.chatgpt;

async function save() {
  const interval = Math.max(MIN_INTERVAL, Math.round(Number($('intervalMin').value) || 15));
  $('intervalMin').value = interval;
  await chrome.storage.local.set({
    settings: {
      background: $('background').checked,
      intervalMin: interval,
      badge: $('badge').checked,
      services: { claude: $('svc-claude').checked, chatgpt: $('svc-chatgpt').checked },
    },
  });
  $('status').textContent = 'Saved.';
}

document.querySelectorAll('input').forEach((i) => i.addEventListener('change', save));
