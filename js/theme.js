// Light and dark theme.

import { icon } from './icons.js';
export const themeEl = document.getElementById('theme-toggle');
export const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(state) {
  if (state.theme) document.documentElement.dataset.theme = state.theme;
  else delete document.documentElement.dataset.theme;
  const dark = (state.theme ?? (systemDark.matches ? 'dark' : 'light')) === 'dark';
  themeEl.replaceChildren(icon(dark ? 'sun' : 'moon'));
  themeEl.setAttribute('aria-label', dark ? 'Tukar ke tema cerah' : 'Tukar ke tema gelap');
  // The browser's bar: a theme chosen by hand wins over the system's.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.content = state.theme ? (dark ? '#060b24' : '#eef3fb') : meta.dataset.default;
  }
}
