// The days of the Islamic year shown in the Takwim Islam section. Holy days
// come from the public holiday table (js/my-holidays.js), so they fall on the
// same dates as in the planner; sunat fasts follow JAKIM's Hijri date. No DOM.

// Holy days as the holiday table names them, and the name shown here.
export const HOLY_DAYS = [
  ['Israk dan Mikraj', 'Israk dan Mikraj'],
  ['Awal Ramadan', 'Awal Ramadan'],
  ['Hari Nuzul Al-Quran', 'Nuzul al-Quran'],
  ['Hari Raya Puasa', 'Hari Raya Aidilfitri'],
  ['Hari Arafah', 'Hari Arafah'],
  ['Hari Raya Qurban', 'Hari Raya Aidiladha'],
  ['Awal Muharam', 'Awal Muharam'],
  ['Hari Keputeraan Nabi Muhammad S.A.W.', 'Maulidur Rasul'],
];

// The next `count` holy days from `fromIso` (YYYY-MM-DD) on, as { date, name }.
export function upcomingHolyDays(rows, fromIso, count) {
  const names = new Map(HOLY_DAYS);
  return rows
    .filter(([date, name]) => date >= fromIso && names.has(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, count)
    .map(([date, name]) => ({ date, name: names.get(name) }));
}

// The sunat fasts of a day, by its Hijri `month` and `day` (JAKIM's) and its
// weekday (0 Sunday … 6 Saturday). None in Ramadan, whose fast is obligatory,
// nor on the days fasting is forbidden: Aidilfitri, Aidiladha and the three
// days of Tasyrik after it.
export function sunatFasts({ month, day }, weekday) {
  if (month === 9 || (month === 10 && day === 1) || (month === 12 && day >= 10 && day <= 13)) return [];
  const fasts = [];
  if (month === 12 && day === 9) fasts.push('Hari Arafah');
  if (month === 1 && day === 9) fasts.push('Tasua');
  if (month === 1 && day === 10) fasts.push('Asyura');
  if (day >= 13 && day <= 15) fasts.push('Ayyamul Bidh');
  if (month === 10) fasts.push('Enam Syawal'); // any six days of Syawal after the first
  if (weekday === 1) fasts.push('Isnin');
  if (weekday === 4) fasts.push('Khamis');
  return fasts;
}
