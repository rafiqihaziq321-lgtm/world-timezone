// The map places: state capitals and larger towns.

import { makeCity } from './storage.js';
import { MALAYSIA_STATES, MALAYSIA_TOWNS } from '../malaysia-data.js';

// Map places: the state capitals (MALAYSIA_STATES, with landmark photos) and
// the larger towns (MALAYSIA_TOWNS). A capital's name is its `capital`.
export const MAP_PLACES = [...MALAYSIA_STATES, ...MALAYSIA_TOWNS];

export function placeName(p) {
  return p.capital ?? p.name;
}

export function stateCity(s) {
  return makeCity(placeName(s), s.zone, s.lat, s.lon);
}
