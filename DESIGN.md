# DESIGN.md: Jam Dunia

Arah reka bentuk untuk antara muka Jam Dunia. Dipilih pada 6 November 2026: hala tuju B, "Meja Kerja". Fail ini ialah data reka bentuk (identiti, palet, tipografi, rasa, dial), bukan arahan kod.

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1

## Identiti

Jam Dunia ialah alat kerja harian untuk orang di Malaysia yang berurusan dengan keluarga dan rakan sekerja di zon lain. Soalan utamanya ialah "pukul berapa di sana, dan bila semua orang boleh bercakap?". Antara muka menjawab soalan itu dahulu: senarai bandar dan perancang diutamakan, bukan pemandangan.

Prinsip:
- **Senarai dahulu.** Jam bandar anda kelihatan pada skrin pertama di setiap lebar.
- **Satu tanda, satu maksud.** Setiap warna, ikon dan garisan membawa maklumat sebenar. Kalau tidak, ia tiada.
- **Tenang, bukan kosong.** Hierarki datang daripada saiz dan berat huruf, bukan daripada hiasan.

## Motif tandatangan: jalur matahari

Setiap bandar ada satu jalur mendatar yang mewakili 24 jam hari itu di bandar tersebut.
- **Segmen:** malam, fajar, siang dan senja. Kedudukannya dikira daripada waktu terbit dan terbenam sebenar (`sunTimes()` dalam `js/time.js`), jadi jalur Oslo pada Disember sangat berbeza daripada jalur Kuala Lumpur.
- **Penanda "sekarang":** satu garis amber menunjukkan saat ini, atau masa yang dipilih pada penukar masa.

Jalur yang sama muncul di tiga tempat:
1. Pada setiap kad bandar, di bawah jam, dengan nama fasa ("Siang", "Malam") di sebelahnya.
2. Pada baris perancang, sebagai garis di bawah setiap jam, sejajar dengan 24 lajur jamnya (kuning siang, gelap malam), supaya mata boleh bergerak dari kad ke jadual tanpa menukar bahasa visual.
3. Pada imej "Kongsi imej jam".

Kad bandar kekal dalam grid (dua lajur pada desktop), dan setiap kad ialah permukaan rata.

Kenapa ini motifnya: jalur itu ialah data, bukan hiasan. Ia satu-satunya bentuk yang menjawab "adakah dia sedang tidur?" dengan sekali pandang. Ia juga milik produk ini: tukar nama dan logo, dan jalur matahari bagi setiap bandar masih mengenal pastinya (ujian tukar nama antislop).

Aksesibiliti: jalur bersifat `aria-hidden`. Maklumatnya ditulis dalam teks baris, contohnya "Siang, matahari terbenam 16:42", supaya fasa tidak bergantung pada warna sahaja.

Logo (`icons/icon.svg`, tanda bulan sabit) tidak diubah. Menukar logo kepada bentuk jalur memerlukan persetujuan pemilik terlebih dahulu.

## Glob

Keputusan: glob dikekalkan, tetapi dikecilkan dan dipindahkan ke bawah perancang sebagai bahagian "Siang dan malam". Kodnya dimuat apabila bahagian itu hampir kelihatan.

Sebab:
- **Tugas dahulu.** Glob kini mengisi skrin pertama dan menolak kad bandar ke y=1813 pada 768x1024 (audit #21). Dua daripada tiga tugas utama bermula di senarai bandar.
- **Bajet.** Glob dan pustakanya berjumlah 134,601 bait pada muatan awal (diukur). Memuatnya kemudian memberi ruang untuk fon dan motif baharu.
- **Tidak dibuang.** Glob menyokong ciri yang berfungsi (klik bandar untuk tambah, garis terminator, label masa). Membuangnya bermakna memadam kelakuan sedia ada, dan itu memerlukan persetujuan.
- **MOTION 1.** Glob tidak berputar sendiri. Ia hanya bergerak apabila diseret, dizum atau apabila pengguna memilih bandar.

## Palet

Dua warna teras (dakwat teal dan batu tulis) ditambah satu aksen (amber). Amber hanya untuk "sekarang" dan matahari, tidak di tempat lain. Warna neutral tidak dikira.

Semua pasangan di bawah disemak dengan `contrast-check.py`: 35 lulus, 0 gagal.

| Token | Cerah | Gelap | Kegunaan |
|---|---|---|---|
| `--bg` | `#F6FAF9` | `#0F1B1A` | Latar halaman (kertas) |
| `--surface` | `#FFFFFF` | `#152523` | Kad bandar, panel, input |
| `--text` | `#134E4A` | `#E6F2F0` | Teks utama (9.01:1 / 15.37:1 pada latar) |
| `--muted` | `#475569` | `#9FB3AF` | Teks sekunder (7.20:1 / 8.00:1) |
| `--action` | `#0F766E` | `#5FB3A8` | Butang utama dan keadaan dipilih sahaja; teks butang `#FFFFFF` / `#0F1B1A` (5.47:1 / 7.13:1). Teal gelap dikurangkan ketepuannya (0.66 → 0.36) |
| `--action-ink` | `#0F766E` | `#8FD0C6` | Pautan, teks tindakan, pilihan unit (9.09:1 pada panel gelap) |
| `--line` | `#7B8B89` | `#5F7572` | Sempadan kawalan (3.56:1 / 3.24:1, bukan teks) |
| `--focus` | `#0F766E` | `#8FD0C6` | Gelang fokus 2 px, ofset 2 px (5.47:1 / 9.09:1) |
| `--now` | `#B45309` (garis), `#92400E` (teks) | `#FBBF24` | Penanda "sekarang", waktu matahari |
| `--error` | `#B42318` | `#FF8A80` | Ralat (6.57:1 / 6.96:1) |
| Jalur: malam | `#1E3A5F` | `#0B2540` | Segmen malam |
| Jalur: siang | `#FDE68A` | `#E8C766` | Segmen siang |
| Jalur: fajar dan senja | kecerunan antara malam dan siang dalam jalur sahaja | sama | Peralihan |

Perancang (teks / latar sel):

| Kategori | Cerah | Gelap | Isyarat bukan warna |
|---|---|---|---|
| Waktu kerja | `#134E4A` / `#CCFBF1` | `#CCFBF1` / `#134E4A` | Teks tersembunyi "kerja" |
| Luar waktu kerja | `#134E4A` / `#FFFFFF` | `#E6F2F0` / `#152523` | Teks tersembunyi "luar waktu kerja" |
| Waktu tidur | `#334155` / `#E2E8F0` | `#CBD5E1` / `#1F2A37` | Teks tersembunyi "tidur" |
| Hujung minggu dan cuti | `#78350F` / `#FEF3C7` | `#FDE68A` / `#4A3410` | Corak jalur serong dan teks tersembunyi "hujung minggu" / "cuti" |
| Tengah malam | garis menegak `--line` 2 px dengan label hari ("Sab") | sama | Teks tersembunyi |

Tiada lagi:
- latar kecerunan pada kad
- cahaya radial dan bintang di latar
- kabur latar (backdrop-filter)
- ungu dan merah jambu

## Tipografi

**Plus Jakarta Sans**, satu keluarga untuk tajuk, badan dan angka jam. Ia direka oleh Tokotype di Jakarta untuk teks Latin rantau ini, dan bunyinya padan dengan Bahasa Melayu. Angka tabularnya sama lebar ("1111" dan "0000" kedua-duanya 96 px pada 40 px, diukur), jadi jam tidak bergoyang setiap saat. Lesen: SIL Open Font License 1.1.

Status:
- **Diluluskan oleh pemilik (6 Nov 2026) dan dipasang (P11):** `vendor/fonts/plus-jakarta-sans-latin-{400,700}-normal.woff2`.
- Unbounded dan Manrope dibuang.
- `vendor/fonts/LICENSES.txt` ialah OFL Plus Jakarta Sans.

Saiz yang dibandingkan sebelum keputusan (subset Latin fontsource, julat Unicode yang sama dengan fail Manrope lama):

| Pilihan | Bait fon | Baki bajet | Baki jika glob dimuat kemudian |
|---|---|---|---|
| 400 + 700 (dipilih) | 24,060 | 52,187 | 186,788 |
| Variable 200-800 | 27,348 | 48,899 | 183,500 |
| Dahulu: Unbounded + Manrope | 75,368 | 879 | tidak berkenaan |

Muatan awal sebenar selepas reka bentuk semula: lihat `anti-slop/plan-001-2026-11-06.md` (status kelompok).

Skala:

| Peranan | Saiz | Berat |
|---|---|---|
| Jam bandar pertama (titik fokus skrin) | `clamp(2.25rem, 1.6rem + 2.6vw, 3.25rem)` | 700, angka tabular |
| Jam baris lain | `1.75rem` | 700, angka tabular |
| Tajuk seksyen (h2) | `1.375rem` | 700 |
| Nama bandar | `1.0625rem` | 700 |
| Badan | `1rem`, line-height 1.55 | 400 |
| Teks kecil | `0.875rem` (tidak lebih kecil) | 400 |

Berat 800, 600 dan 500 dipetakan ke 700; 300 dan 200 ke 400. Dalam `style.css` hanya `font-weight: 400` dan `700` digunakan (kelompok 4). Glob kanvas menggunakan fon sistem dan tidak termasuk. Imej kongsi (`js/share-image.js`) menggunakan keluarga dan berat yang sama.

## Rasa

Meja kerja yang kemas pada pagi Isnin: kertas putih kehijauan, dakwat teal gelap, satu pen amber untuk menanda "sekarang".

- **ENERGY 2.** Satu elemen kuat setiap skrin, iaitu jam bandar pertama dalam saiz besar. Selebihnya tenang dengan perbezaan berat 700/400 yang jelas.
- **RHYTHM 2.** Kad bandar dan baris perancang berirama sama (motif jalur). Ada dua pecahan yang disengajakan: perancang ialah panel lebar penuh, dan fakta zon waktu menjadi senarai padat dua lajur, bukan kad.
- **MOTION 1.** Hanya keadaan hover, fokus, tekan dan peralihan keadaan (150-200 ms). Tiada animasi masuk, tiada putaran glob automatik, tiada denyut berterusan. Butang "Main 24 jam" menggerakkan jam hanya apabila ditekan, dan butang yang sama menghentikannya.

## Bentuk dan ruang

- **Butang (7 Nov 2026):** satu tindakan utama setiap bahagian sahaja diisi teal (contohnya Main 24 jam, Tambah bandar, Tambah kiraan). Tindakan lain ialah butang senyap: latar tinta 8% tanpa garis luar. Butang ikon (pautan, tema, imej, zum glob, ‹ ›, ×) tanpa sempadan.
- **Tab:** tab semasa ditanda dengan garis bawah teal 2 px, bukan pil berisi.
- **Tahap amaran:** perkataan MET ("Waspada", "Buruk", "Bahaya") dalam label, bukan jalur warna di tepi kad.
- **Kawasan amaran:** teks MET dipecah kepada tempoh, negeri dan daerah (label kecil), dengan "Semak kawasan anda" di atas. Padanan memakai warna pilihan (teal); amaran yang tidak menyebut tempat itu dilipat ke tajuknya. Amaran laut dipecah ikut seksyen MET (perairan Malaysia, perkapalan), jenis amaran, tempoh dan kawasan perairan. Negeri tanpa daerah berkongsi satu baris "Seluruh negeri". Label tahap hanya jika MET menamakannya; buletin "Tiada Nasihat" tidak dipaparkan. Teks penuh MET kekal di bawah, dan jika teks tidak dapat dipecah, ringkasan lama dipaparkan.
- **Di bawah tajuk bahagian:** hanya sumber data rasmi, kecil (`0.875rem`).

- **Radius:** 6 px untuk kawalan (butang, input), 10 px untuk baris dan panel. Bentuk pil hanya untuk cip penapis dan lencana UTC, kerana bentuk itu memberi tahu "ini label, bukan butang".
- **Bayang:** tiada pada baris dan panel. Bayang hanya untuk elemen yang benar-benar terapung: dialog, bar "Batal" dan tooltip glob.
- **Ruang:** skala 4 / 8 / 12 / 16 / 24 / 40 / 64 px. Jarak antara seksyen 40 px pada telefon dan 64 px pada desktop, bukan 112 px.
- **Sasaran sentuh:** minimum 44 x 44 px untuk setiap kawalan, termasuk × buang, seret dan butang nama, dengan jarak 8 px antara sasaran bersebelahan.

## Salinan

- Bahasa Melayu biasa, ayat pendek, tiada em dash.
- Tiada slogan pemasaran di skrin utama. Tajuk halaman menyatakan fungsi: "Jam Dunia" dengan masa dan tarikh anda.
- Label kelihatan pada setiap medan. Petunjuk hanya memberi contoh, bukan nama medan.
- Nilai kosong ditulis "tiada", bukan tanda sempang panjang.
