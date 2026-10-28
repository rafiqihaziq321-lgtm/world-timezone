// Small DOM and data helpers shared by every part of the page.
export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} (${url})`);
  return response.json();
}

// Fetches are remembered for the page's lifetime, so ticking the clock or
// reopening a panel never repeats a request. A failed one can be retried.
export function createLocalData(onSettled) {
  const entries = new Map();
  return {
    // `source` is a URL to fetch as JSON, or a function returning a promise.
    get(key, source) {
      let entry = entries.get(key);
      if (!entry) {
        entry = { status: 'loading', data: null, error: null };
        entries.set(key, entry);
        const load = typeof source === 'function' ? source : () => fetchJson(source);
        load().then(
          (data) => Object.assign(entry, { status: 'ok', data }),
          (err) => {
            Object.assign(entry, { status: 'error', error: err });
            console.info('Jam Dunia: data luar gagal dimuat.', err);
          },
        ).finally(onSettled);
      }
      return entry;
    },
    retry(key) {
      entries.delete(key);
      onSettled();
    },
  };
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderKeyed(node, key, build) {
  if (node.dataset.key === key) return;
  node.dataset.key = key;
  node.replaceChildren(...build());
}

// "28°C" or "82°F", by the viewer's setting; Celsius in.
export function formatTemp(state, celsius) {
  const value = state.tempUnit === 'f' ? Number(celsius) * 9 / 5 + 32 : Number(celsius);
  return `${String(Math.round(value)).replace('-', '−')}°${state.tempUnit === 'f' ? 'F' : 'C'}`;
}

// "24–33°C" (MET's daily range).
export function formatTempRange(state, min, max) {
  return `${formatTemp(state, min).replace(/°[CF]$/, '')}–${formatTemp(state, max)}`;
}

// "São Paulo " -> "sao paulo", so searches ignore case and accents.
export function normalizeName(text) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}
