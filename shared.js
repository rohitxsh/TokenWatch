// Shared by background, popup and options.
export const SERVICES = {
  claude: { name: 'Claude', host: 'claude.ai', url: 'https://claude.ai/settings/usage' },
  chatgpt: { name: 'ChatGPT', host: 'chatgpt.com', url: 'https://chatgpt.com/settings/usage?tab=overview' },
};

export const MIN_INTERVAL = 5;
const DEFAULTS = { intervalMin: 15, background: true, badge: true, services: { claude: true, chatgpt: true } };

export async function getSettings() {
  const { settings: s = {} } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...s, services: { ...DEFAULTS.services, ...s.services } };
}

// green < 70, amber 70–90, red > 90
export const level = (p) => (p > 90 ? 'crit' : p >= 70 ? 'warn' : 'ok');
export const COLORS = { ok: '#1e8e3e', warn: '#e8a200', crit: '#d93025' };
