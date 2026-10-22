// Light and dark theme.
export const themeEl = document.getElementById('theme-toggle');
export const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(state) {
  if (state.theme) document.documentElement.dataset.theme = state.theme;
  else delete document.documentElement.dataset.theme;
  const dark = (state.theme ?? (systemDark.matches ? 'dark' : 'light')) === 'dark';
  themeEl.textContent = dark ? '☀️' : '🌙';
  themeEl.setAttribute('aria-label', dark ? 'Tukar ke tema cerah' : 'Tukar ke tema gelap');
}
