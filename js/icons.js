// One set of line icons in place of emoji, which every platform draws in its
// own style and size. 24×24, stroked in the text colour, hidden from screen
// readers: the words beside an icon (or its button's label) carry the meaning.

const CLOUD = '<path d="M7 15h10a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.6 8.6 3.2 3.2 0 0 0 7 15z"/>';

const PATHS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  sunrise: '<path d="M2 18h20M7 18a5 5 0 0 1 10 0M4.6 11.6 6 13M19.4 11.6 18 13M2 15h2M20 15h2M12 2v6M9.5 4.5 12 2l2.5 2.5M6 21.5h12"/>',
  sunset: '<path d="M2 18h20M7 18a5 5 0 0 1 10 0M4.6 11.6 6 13M19.4 11.6 18 13M2 15h2M20 15h2M12 2v6M9.5 5.5 12 8l2.5-2.5M6 21.5h12"/>',
  'sun-cloud': '<path d="M8 3v1.5M3 8h1.5M4.5 4.5l1 1M11.5 4.5l-1 1M5.6 10.4A3 3 0 1 1 10.6 7"/><path d="M9 20h8a3.5 3.5 0 0 0 .4-6.98 5 5 0 0 0-9.8.58A3.2 3.2 0 0 0 9 20z"/>',
  'moon-cloud': '<path d="M11 4.6A4.5 4.5 0 0 0 5 10.2"/><path d="M9 20h8a3.5 3.5 0 0 0 .4-6.98 5 5 0 0 0-9.8.58A3.2 3.2 0 0 0 9 20z"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18z"/>',
  fog: '<path d="M4 8h16M3 12h18M5 16h14M8 20h8"/>',
  drizzle: `${CLOUD}<path d="M9 18v1M13 18v1M11 21v.5M15 21v.5"/>`,
  rain: `${CLOUD}<path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/>`,
  snow: `${CLOUD}<path d="M8 18.5h.01M12 18.5h.01M16 18.5h.01M10 21.5h.01M14 21.5h.01"/>`,
  storm: `${CLOUD}<path d="M12.5 15.5 10 19h4l-2.5 3.5"/>`,
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  install: '<rect x="6.5" y="2.5" width="11" height="19" rx="2"/><path d="M12 7v7M9 11l3 3 3-3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  'bell-off': '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0M3 3l18 18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mosque: '<path d="M3 21h18M5 21v-7h14v7M7 14a5 5 0 0 1 10 0M12 4.5v4.5M10 21v-3a2 2 0 0 1 4 0v3"/>',
  kaaba: '<path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z"/><path d="M4 7.5 12 11l8-3.5M12 11v9M4 10.5l8 3.5 8-3.5"/>',
  warning: '<path d="M12 3 2 20h20z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('data-glyph', name); // which icon, for tests and styling
  svg.innerHTML = PATHS[name];
  return svg;
}

// The paths alone, to draw inside another SVG (the qibla dial).
export function iconPaths(name) {
  return PATHS[name];
}

// Buttons and labels written in index.html name their icon in data-icon.
export function placeIcons(root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) node.prepend(icon(node.dataset.icon));
}
