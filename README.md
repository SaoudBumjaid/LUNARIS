# LUNARIS — Land, then drive.

**NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator · Team Karak & Cosmos (NCST, Kingdom of Bahrain)**

Existing tools answer *"where and when can a lander get Sun and Earth?"*. LUNARIS answers the next question:
**"Where can we land safely — and can the rover reach a cold-trap target and get back before the moving shadows drain its battery?"**

**▶ Live app:** https://ipo735723-afk.github.io/LUNARIS/ — runs in any modern browser, no install.

**▶ 7-slide demo:** [docs/presentation/LUNARIS_Demo_7_Slides.pdf](docs/presentation/LUNARIS_Demo_7_Slides.pdf) · full deck: [docs/presentation/LUNARIS_NASA_Space_Apps_2026.pdf](docs/presentation/LUNARIS_NASA_Space_Apps_2026.pdf)

**Team:** Saoud Abdulaziz Bumjaid · Abdulrahman Ahmed Albi · Rashid Alothman · Shamsan Al Bastaki

> Independent student prototype. Not affiliated with or endorsed by NASA. Scores are transparent planning heuristics, not a landing-safety certification.

---

## تشغيل سريع (Windows)

1. ثبّت **Node.js 20 أو أحدث** من https://nodejs.org
2. انقر مرتين على **`START_LUNARIS.bat`**. أول مرة يثبّت المكتبات (دقيقة أو دقيقتان) ثم يفتح التطبيق على `http://localhost:5173`.
3. البيانات الحقيقية موجودة داخل المشروع، فلا تحتاج أي تنزيل. اختر المنطقة من القائمة في أعلى اليسار.

لإعادة بناء البيانات والتحقق منها (اختياري): ثبّت **Python 3.10+** ثم انقر مرتين على **`BUILD_REAL_DATA.bat`** (دقيقة أو دقيقتان، بدون إنترنت بعد تثبيت المكتبات).

## Quick start (any OS)

```bash
cd web && npm install && npm run dev        # http://localhost:5173
# rebuild + re-check the real data (optional, offline):
cd pipeline && pip install -r requirements.txt
python validate_ephemeris.py && python validate_illumination.py && python build_open.py && python build_extras.py
# tests
cd web && npx tsx tests/planner_real.test.ts && npx tsx tests/sky.test.ts && npx tsx tests/departure_scan.test.ts
```

---

## Real data, checked

* **Terrain:** NASA LRO **LOLA** south-pole elevation models — 20 m near each site (Barker et al. 2023 DEMs), 400 m out to 300 km (LDEM_80S_80M).
* **Sun & Earth:** computed by LUNARIS from **JPL DE421** + the IAU lunar rotation model.
  Checked against **JPL Horizons**: max error **0.003°** over 8 761 hourly samples.
* **Sunlight on terrain:** Connecting Ridge, 5 m mast, 2024–2026: LUNARIS **89.2 %** vs **88.1 %** published by Barker et al. (2021).
* **DSN view of the Moon** (Goldstone, Madrid, Canberra) from the same ephemeris, checked against JPL Horizons: max 0.0013°.
* Six south-pole regions (8 × 8 km): Connecting Ridge, **IM-2 Athena (CLPS landing site)**, Malapert Massif, Nobile Rim 1, Nobile Rim 2, Haworth.

Details: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) · [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md)

## The key result

Across 5 regions and 300 departure times, a classic shortest-path plan brings the rover back safely 136 times. LUNARIS's
**sun-aware, time-dependent planner** does it **193 times (+42 %)** with the same rover — because it routes around shadows that move every hour.
Example: Malapert Massif, 15 Jan 2027 — the shortest path drops below the 20 % battery reserve after 4.3 h; the sun-aware path finishes the 4.2 km trip with 32 % left.

## Pages

- **South Pole Map** — zoomable LOLA shaded-relief map of the pole with the six regions; zoom in to see LUNARIS's own 40 m relief or yearly sunlight inside each region. Click a region for its numbers, open a site, or add it to Compare.
- **Sun & Earth** — for any site and hour: Sun and Earth azimuth/elevation, the terrain skyline at that azimuth, visible part of the Sun, Earth line of sight, which DSN complexes see the Moon; skyline panorama with Sun and Earth paths; hourly strips; sunlight and communication windows; solar energy.
- **Compare Sites** — 2–4 sites from any regions, or one site on up to 4 dates: winner with its worked score, side-by-side bars, exact numbers, three synchronized charts, CSV export with provenance. Goals: Balanced / Power first / Earth contact first, or your own weight.

Existing pages (all still tested):

- **Mission Command** — region, candidate sites with scores, science targets (computed permanently shadowed regions), risks and data confidence.
- **Lunar Explorer** — 3-D / 2-D terrain with 8 data layers, shadow animation, skyline vs Sun and Earth paths, terrain-aware vs geometric sunlight.
- **Landing Safety** — slope hazard inside the landing ellipse, six weighted criteria with visible formulas, 90-day best-landing-date scan.
- **Traverse Planner** — shortest vs **sun-aware** route, battery along the route, departure-window finder, blocked areas, report export.
- **What If? Simulator** — landing slips, longer shadows, Earth-link outage, blocked route, less solar power: before/after with reasons.
- **Data & Sources** — provenance of every layer, methods, validation results, limits.

## What is new compared with existing tools

We reviewed Lunar Horizon, LUNAR//OPS, SIGHTLINE and the Ohio University Lunar Planner. They model Sun and Earth visibility well, and two of them validate it.
None of them plans a **rover traverse through moving shadows with a battery model**, checks **slope hazards inside the landing ellipse**, or runs **What-If for the whole surface mission**. LUNARIS adds those on top of the same validated geometry.

## Method summary

* **Horizons:** ray-marching on the 40 m grid for 72 azimuths with lunar curvature, merged with a 300 km great-circle scan of the 400 m DEM, re-referenced to each cell's height.
* **Sunlight:** visible fraction of the solar disc above each cell's horizon, hourly. **Earth:** Earth centre above the horizon (geometry only).
* **PSR:** cells where the top of the Sun never clears the horizon during the year (potential cold traps, not confirmed ice).
* **Sun-aware traverse:** weighted time-dependent A* over (cell, hour, battery), moves limited by slope, waiting allowed to recharge or for sunrise. Energy = panel W × visible disc − drive/idle W.

## Project layout

```
LUNARIS/
  START_LUNARIS.bat         Windows: install + run the web app
  BUILD_REAL_DATA.bat       Windows: re-check (JPL Horizons, Barker 2021) and rebuild the datasets
  pipeline/                 Python: ephemeris, horizons, illumination, PSR, slope
    lunaris/ephem.py        Sun/Earth from JPL DE421 + IAU lunar rotation
    lunaris/core.py         horizons, illumination, PSR, slope, export
    build_open.py           builds the six real regions from bundled open data
    validate_*.py           checks against JPL Horizons and Barker et al. 2021
    data/third_party/       open LOLA-derived terrain (Apache-2.0 / MIT, credited)
    fetch_data.py, build_real.py   optional builder from raw SPICE kernels + a LOLA DEM download
  web/                      React + TypeScript + Vite + three.js + Recharts
    public/data/<region>/   datasets used by the app
    src/engine/             illumination, site scoring, traverse planner (TypeScript)
    tests/                  planner and departure-window tests on real data, browser test
  docs/                     data sources, test results
```

## Credits and use of AI

* Terrain derivatives: **LUNAR//OPS** (Apache-2.0) and **Lunar Horizon** (MIT) — see `pipeline/data/third_party/README.md`. All LUNARIS analysis code is our own.
* NASA LRO LOLA team, NASA GSFC PGDA, JPL Solar System Dynamics (Horizons, DE421), Skyfield (MIT).
* **Use of AI:** the team used AI assistants (Claude, by Anthropic) to help write and debug code, documentation and presentation text. All numbers come from running the code; the team reviewed the work.

## Limits

Boulders and craters smaller than ~40 m are not resolved · ideal Sun-tracking panel, no thermal or dust model · communication is geometric (line of sight + DSN view of the Moon), no antenna schedule or link budget ·
5° horizon bins · the sun-aware planner is bounded-suboptimal (ε = 1.4) to stay interactive · PSRs are potential cold traps, not confirmed ice.
