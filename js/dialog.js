// The city details dialog.

import { placeName } from './places.js';
import { el } from './util.js';

export function openCityDialog(state, s) {
  const dialog = document.getElementById('city-dialog');
  state.dialogState = s;
  const title = el('h2', '', placeName(s));
  title.id = 'city-dialog-title';
  const panel = el('div', 'local-panel');
  document.getElementById('city-dialog-body').replaceChildren(
    ...(s.landmark ? [el('div', 'dialog-photo')] : []),
    title,
    el('p', 'city-state', s.landmark ? `${s.state}. ${s.landmarkName}` : s.state),
    panel,
  );
  dialog.showModal();
  state.refresh();
}

// ---------- Estimated air quality (Open-Meteo, CAMS model) ----------
