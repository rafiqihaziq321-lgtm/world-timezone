// The person in a city: a name for its card and planner row, and their own
// working day when it differs from the shared one. Loaded the first time a
// card's person button is pressed; the dialog is built then.

import { cityKey } from '../globe.js';
import { renderCards } from './cards.js';
import { WEEKDAYS } from './planner.js';
import { saveState } from './storage.js';
import { minuteText } from './time.js';
import { el } from './util.js';

function build(state) {
  const dialog = el('dialog');
  dialog.id = 'person-dialog';
  dialog.setAttribute('aria-labelledby', 'person-title');
  dialog.innerHTML = `
    <form method="dialog" class="dialog-close"><button type="submit" aria-label="Tutup">×</button></form>
    <form class="person-form">
      <h2 id="person-title"></h2>
      <label>Nama <input name="label" maxlength="40" autocomplete="off" placeholder="cth. Aina"></label>
      <label class="person-own"><input type="checkbox" name="own"> Waktu kerja sendiri</label>
      <fieldset name="work">
        <legend>Waktu kerja (waktu bandar ini)</legend>
        <label>Mula <select name="start"></select></label>
        <label>Tamat <select name="end"></select></label>
        <div class="person-days" role="group" aria-label="Hujung minggu"></div>
      </fieldset>
      <div class="person-actions">
        <button type="submit" class="btn">Simpan</button>
        <button type="button" class="secondary" name="clear">Padam</button>
      </div>
    </form>`;
  const form = dialog.querySelector('.person-form');
  const { start, end, own, work } = form.elements;
  for (let m = 0; m <= 24 * 60; m += 30) {
    if (m < 24 * 60) start.append(new Option(minuteText(m), String(m)));
    if (m > 0) end.append(new Option(minuteText(m), String(m)));
  }
  for (const [day, name, short] of WEEKDAYS) {
    const label = el('label', 'day-toggle');
    const box = el('input');
    box.type = 'checkbox';
    box.name = 'weekend';
    box.value = String(day);
    box.setAttribute('aria-label', name);
    label.append(box, el('span', '', short));
    form.querySelector('.person-days').append(label);
  }
  own.addEventListener('change', () => { work.disabled = !own.checked; });
  // A range always keeps at least an hour, as in the shared setting.
  start.addEventListener('change', () => {
    if (Number(start.value) >= Number(end.value)) end.value = String(Math.min(Number(start.value) + 60, 24 * 60));
  });
  end.addEventListener('change', () => {
    if (Number(start.value) >= Number(end.value)) start.value = String(Math.max(Number(end.value) - 60, 0));
  });
  // Saving replaces the city in the list with its new name and hours.
  const save = (label, ownWork) => {
    state.cities = state.cities.map((c) => {
      if (cityKey(c) !== dialog.dataset.key) return c;
      const { label: _l, work: _w, ...rest } = c;
      return { ...rest, ...(label ? { label } : {}), ...(ownWork ? { work: ownWork } : {}) };
    });
    saveState(state);
    renderCards(state);
    state.refresh();
    dialog.close();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const weekend = [...form.querySelectorAll('input[name="weekend"]:checked')].map((box) => Number(box.value));
    save(form.elements.label.value.trim(), own.checked ? { start: Number(start.value), end: Number(end.value), weekend } : null);
  });
  form.elements.clear.addEventListener('click', () => save('', null));
  document.body.append(dialog);
  return dialog;
}

export function openPersonDialog(state, city) {
  const dialog = document.getElementById('person-dialog') ?? build(state);
  const form = dialog.querySelector('.person-form');
  const hours = city.work ?? state.work; // a fresh form starts from the shared day
  dialog.dataset.key = cityKey(city);
  dialog.querySelector('h2').textContent = `Orang di ${city.name}`;
  form.elements.label.value = city.label ?? '';
  form.elements.own.checked = Boolean(city.work);
  form.elements.work.disabled = !city.work;
  form.elements.start.value = String(hours.start);
  form.elements.end.value = String(hours.end);
  for (const box of form.querySelectorAll('input[name="weekend"]')) box.checked = hours.weekend.includes(Number(box.value));
  dialog.showModal();
}
