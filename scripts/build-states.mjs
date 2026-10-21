// Builds data/malaysia-states.json, the state outlines the map colours for
// MET warnings, from DOSM's official boundaries (Open Data Licence):
//   https://github.com/dosm-malaysia/data-open  datasets/geodata/administrative_1_state.geojson
// Usage: node scripts/build-states.mjs path/to/administrative_1_state.geojson
// Outlines are simplified to about 1 km and rounded to 3 decimals (~100 m),
// plenty for colouring whole states at country zoom.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOLERANCE = 0.01; // degrees
const root = fileURLToPath(new URL('..', import.meta.url));
const source = JSON.parse(readFileSync(process.argv[2], 'utf8'));

// Douglas–Peucker on one ring, keeping its first and last point.
function simplify(points) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const length = Math.hypot(bx - ax, by - ay);
    let worst = -1;
    let index = -1;
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = points[i];
      // A closed ring starts and ends on the same point: measure from it.
      const d = length === 0
        ? Math.hypot(px - ax, py - ay)
        : Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / length;
      if (d > worst) [worst, index] = [d, i];
    }
    if (worst > TOLERANCE) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = ([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
const features = source.features.map((f) => {
  const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const coordinates = polygons
    .map((rings) => rings.map((ring) => simplify(ring).map(round)).filter((ring) => ring.length >= 4))
    .filter((rings) => rings.length);
  return { type: 'Feature', properties: { state: f.properties.state }, geometry: { type: 'MultiPolygon', coordinates } };
});

mkdirSync(`${root}data`, { recursive: true });
writeFileSync(`${root}data/malaysia-states.json`, JSON.stringify({ type: 'FeatureCollection', features }));
console.log('data/malaysia-states.json', features.map((f) => f.properties.state).join(', '));
