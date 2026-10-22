// The 13 states and 3 federal territories, each represented by its capital.
//
// population: millions, 2025, DOSM "Current Population Estimates" (state table,
//   rounded to 0.1 million). DOSM's table omits the three federal territories in
//   the excerpt we could verify; their figures are the national total (34.2) less
//   the 13 states, split using DOSM's 2025 densities, and agree to 0.1 million.
// area: km², computed from DOSM's official state boundaries
//   (dosm-malaysia/data-open, administrative_1_state.geojson); within about 1%
//   of the published figures (Labuan about 5%), so shown as approximate.
// landmark: English Wikipedia article whose lead photo is shown in the Bandar tab.
// lat/lon: the capital, from vendor/cities.js (Kuala Lumpur matches the globe).
export const MALAYSIA_STATES = [
  { state: 'Johor', capital: 'Johor Bahru', zone: 'Asia/Kuala_Lumpur', lat: 1.48, lon: 103.73, population: 4.2, area: 19300, landmark: 'Sultan_Ibrahim_Building', landmarkName: 'Bangunan Sultan Ibrahim' },
  { state: 'Kedah', capital: 'Alor Setar', zone: 'Asia/Kuala_Lumpur', lat: 6.11, lon: 100.37, population: 2.2, area: 9500, landmark: 'Alor_Setar_Tower', landmarkName: 'Menara Alor Setar' },
  { state: 'Kelantan', capital: 'Kota Bharu', zone: 'Asia/Kuala_Lumpur', lat: 6.13, lon: 102.24, population: 1.9, area: 15200, landmark: 'Istana_Jahar', landmarkName: 'Istana Jahar' },
  { state: 'Melaka', capital: 'Melaka', zone: 'Asia/Kuala_Lumpur', lat: 2.19, lon: 102.25, population: 1.1, area: 1660, landmark: 'A_Famosa', landmarkName: 'A Famosa' },
  { state: 'Negeri Sembilan', capital: 'Seremban', zone: 'Asia/Kuala_Lumpur', lat: 2.71, lon: 101.94, population: 1.2, area: 6710, landmark: 'Negeri_Sembilan_State_Mosque', landmarkName: 'Masjid Negeri, Negeri Sembilan' },
  { state: 'Pahang', capital: 'Kuantan', zone: 'Asia/Kuala_Lumpur', lat: 3.83, lon: 103.32, population: 1.7, area: 36100, landmark: 'Sultan_Ahmad_Shah_Mosque', landmarkName: 'Masjid Sultan Ahmad Shah' },
  { state: 'Perak', capital: 'Ipoh', zone: 'Asia/Kuala_Lumpur', lat: 4.6, lon: 101.06, population: 2.6, area: 21000, landmark: 'Ipoh_railway_station', landmarkName: 'Stesen Kereta Api Ipoh' },
  { state: 'Perlis', capital: 'Kangar', zone: 'Asia/Kuala_Lumpur', lat: 6.43, lon: 100.19, population: 0.3, area: 820, landmark: 'Alwi_Mosque', landmarkName: 'Masjid Alwi' },
  { state: 'Pulau Pinang', capital: 'George Town', zone: 'Asia/Kuala_Lumpur', lat: 5.41, lon: 100.33, population: 1.8, area: 1050, landmark: 'Kek_Lok_Si', landmarkName: 'Kek Lok Si, Air Itam' },
  { state: 'Sabah', capital: 'Kota Kinabalu', zone: 'Asia/Kuching', lat: 5.98, lon: 116.11, population: 3.8, area: 74500, landmark: 'Kota_Kinabalu_City_Mosque', landmarkName: 'Masjid Bandaraya Kota Kinabalu' },
  { state: 'Sarawak', capital: 'Kuching', zone: 'Asia/Kuching', lat: 1.53, lon: 110.33, population: 2.5, area: 124500, landmark: 'Darul_Hana_Bridge', landmarkName: 'Jambatan Darul Hana' },
  { state: 'Selangor', capital: 'Shah Alam', zone: 'Asia/Kuala_Lumpur', lat: 3.07, lon: 101.55, population: 7.4, area: 7940, landmark: 'Sultan_Salahuddin_Abdul_Aziz_Mosque', landmarkName: 'Masjid Sultan Salahuddin Abdul Aziz Shah' },
  { state: 'Terengganu', capital: 'Kuala Terengganu', zone: 'Asia/Kuala_Lumpur', lat: 5.33, lon: 103.12, population: 1.2, area: 13000, landmark: 'Crystal_Mosque', landmarkName: 'Masjid Kristal' },
  { state: 'W.P. Kuala Lumpur', capital: 'Kuala Lumpur', zone: 'Asia/Kuala_Lumpur', lat: 3.14, lon: 101.69, population: 2.1, area: 243, landmark: 'Petronas_Towers', landmarkName: 'Menara Berkembar Petronas' },
  { state: 'W.P. Labuan', capital: 'Labuan', zone: 'Asia/Kuching', lat: 5.28, lon: 115.24, population: 0.1, area: 96, landmark: 'Labuan_War_Cemetery', landmarkName: 'Tanah Perkuburan Perang Labuan' },
  { state: 'W.P. Putrajaya', capital: 'Putrajaya', zone: 'Asia/Kuala_Lumpur', lat: 2.91, lon: 101.7, population: 0.1, area: 49, landmark: 'Putra_Mosque', landmarkName: 'Masjid Putra' },
];

export const MALAYSIA_TOTAL = { population: 34.2, area: 331700 }; // same sources as above

// Larger towns shown on the map when zoomed in: the Malaysian places in
// vendor/cities.js (Natural Earth, via city-timezones) that are not state
// capitals, with their Malay spelling. metNames: how MET Malaysia may name
// the town in its forecasts, tried in order.
export const MALAYSIA_TOWNS = [
  { name: 'Batu Pahat', state: 'Johor', zone: 'Asia/Kuala_Lumpur', lat: 1.85, lon: 102.93 },
  { name: 'Kluang', state: 'Johor', zone: 'Asia/Kuala_Lumpur', lat: 2.04, lon: 103.32, metNames: ['Kluang', 'Keluang'] },
  { name: 'Muar', state: 'Johor', zone: 'Asia/Kuala_Lumpur', lat: 2.03, lon: 102.57 },
  { name: 'Sungai Petani', state: 'Kedah', zone: 'Asia/Kuala_Lumpur', lat: 5.65, lon: 100.48 },
  { name: 'Raub', state: 'Pahang', zone: 'Asia/Kuala_Lumpur', lat: 3.79, lon: 101.84 },
  { name: 'Kuala Lipis', state: 'Pahang', zone: 'Asia/Kuala_Lumpur', lat: 4.18, lon: 102.04, metNames: ['Kuala Lipis', 'Lipis'] },
  { name: 'Taiping', state: 'Perak', zone: 'Asia/Kuala_Lumpur', lat: 4.86, lon: 100.72 },
  { name: 'Teluk Intan', state: 'Perak', zone: 'Asia/Kuala_Lumpur', lat: 4.01, lon: 101.03 },
  { name: 'Butterworth', state: 'Pulau Pinang', zone: 'Asia/Kuala_Lumpur', lat: 5.42, lon: 100.4 },
  { name: 'Sandakan', state: 'Sabah', zone: 'Asia/Kuching', lat: 5.84, lon: 118.11 },
  { name: 'Tawau', state: 'Sabah', zone: 'Asia/Kuching', lat: 4.27, lon: 117.9 },
  { name: 'Lahad Datu', state: 'Sabah', zone: 'Asia/Kuching', lat: 5.05, lon: 118.34 },
  { name: 'Miri', state: 'Sarawak', zone: 'Asia/Kuching', lat: 4.4, lon: 113.98 },
  { name: 'Sibu', state: 'Sarawak', zone: 'Asia/Kuching', lat: 2.3, lon: 111.84 },
  { name: 'Bintulu', state: 'Sarawak', zone: 'Asia/Kuching', lat: 3.17, lon: 113.04 },
  { name: 'Klang', state: 'Selangor', zone: 'Asia/Kuala_Lumpur', lat: 3.02, lon: 101.55, metNames: ['Klang', 'Kelang'] },
  { name: 'Chukai', state: 'Terengganu', zone: 'Asia/Kuala_Lumpur', lat: 4.23, lon: 103.45, metNames: ['Chukai', 'Kemaman'] },
];
