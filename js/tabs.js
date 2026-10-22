// The three tabs, chosen by the URL hash.
export const TABS = ['dunia', 'malaysia', 'bandar-malaysia'];
// Shows the tab named by the hash, or the tab containing the element it
// names (so #perancang still works), defaulting to the world clock.
export function showTab(hash) {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  let tab = TABS.includes(id) ? id : null;
  if (!tab && id) tab = document.getElementById(id)?.closest('.tab-panel')?.id ?? null;
  tab = tab ?? 'dunia';
  for (const name of TABS) document.getElementById(name).hidden = name !== tab;
  for (const link of document.querySelectorAll('.nav-links a')) {
    if (link.getAttribute('href') === `#${tab}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  return tab;
}
