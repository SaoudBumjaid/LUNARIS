# LUNARIS — test results (14 November 2026)

Every number below comes from running the code in this repository. Commands are given so anyone can repeat them.

## 1. Sun and Earth directions vs JPL Horizons — PASS
`python pipeline/validate_ephemeris.py` → `pipeline/validation/ephemeris_vs_horizons.json`

| | Samples | Max direction error | RMS | Criterion |
|---|---|---|---|---|
| Sun | 8 761 hourly (2026-11-01 → 2027-11-01) | **0.003°** | 0.0017° | < 0.05° |
| Earth | 8 761 hourly | **0.003°** | 0.0016° | < 0.05° |

Reference: JPL Horizons (DE441, MEAN_ME) at the IM-2 Athena landing point (84.7906° S, 29.1957° E). The Sun's disc is 0.53° wide, so the error is about 1/180 of the disc.

## 2. Sunlight on real terrain vs a published study — PASS
`python pipeline/validate_illumination.py` → `pipeline/validation/illumination_vs_barker2021.json`

Connecting Ridge RoI 4, 2024-01-01 → 2026-01-01:

| Height | LUNARIS average visible Sun | LUNARIS longest shadow | Published (Barker et al. 2021, Table 2) |
|---|---|---|---|
| 5 m | **89.2 %** | **3.5 days** | 88.1 %, about 4.0 days |
| 1 m | 83.7 % | 6.2 days | range 52.2–86.8 % (1st percentile 69.6 %) |

Criteria fixed before running: 5 m average within 83–93 %, longest shadow ≤ 6 days.

## 3. Planner on the real datasets — 57 / 57 checks PASS
`cd web && npx tsx tests/planner_real.test.ts` → `web/tests/planner_real_results.json`

For each of the six regions: dataset is real with 8 760 hourly samples; the browser's sunlight equals the pipeline's (within 0.1 point);
site score is 0–100. For every feasible sun-aware route (5 regions × up to 4 departure dates): the route returns to the site, time only moves forward,
the battery never goes below the 20 % reserve, and every cell is within the 18° slope limit. Nobile Rim 2 has no PSR target large enough, so its traverse is skipped.

## 4. Does time-aware routing matter? — departure-window scan
`cd web && npx tsx tests/departure_scan.test.ts` → `web/tests/departure_scan_results.json`

Rover: 0.1 m/s, 350 W panel, 250 W driving, 70 W idle, 2 500 Wh battery, 20 % reserve, 18° max slope. Trip: landing site → nearest PSR edge → back.
60 departures (every 12 h, 15 Jan – 14 Feb 2027) per region:

| Region | Both work | **Only the sun-aware plan works** | Neither |
|---|---|---|---|
| Malapert Massif | 43 | **17** | 0 |
| Haworth | 20 | **21** | 19 |
| Connecting Ridge | 17 | **11** | 32 |
| Nobile Rim 1 | 28 | **4** | 28 |
| IM-2 Athena | 28 | **4** | 28 |
| **Total (300)** | **136** | **57** | **107** |

The shortest-path plan never succeeded where the sun-aware plan failed. The sun-aware planner found a safe trip in 193 of 300 departures, against 136 for the shortest path (+42 %).

## 5. Browser test of the built app — 9 / 9 steps PASS
`npx vite preview` then `python web/tests/e2e_browser.py http://localhost:4173/ out/`
Real dataset loads with the REAL DATA label · 3-D explorer renders · landing-safety 90-day scan · shortest vs sun-aware routes
(Malapert, 15 Jan 2027: shortest path fails at the 20 % reserve, sun-aware path feasible) · departure-window scan · What-If "less solar energy" ·
sources page shows the validation · region switch to IM-2 Athena · no page errors.

## Not tested
* No comparison with real rover traverses (none exist at these sites).
* Radio links (DSN), thermal, dust, boulders: not modelled.

## v2 additions (14 November 2026)

### DSN geometry vs JPL Horizons — PASS
`pipeline/validation/dsn_vs_horizons.json`. Moon elevation from the Goldstone complex (35.4259° N, 243.1105° E, 1.0 km), hourly 1–31 January 2027 (721 samples), LUNARIS/Skyfield + DE421 vs JPL Horizons (observer at the same coordinates, airless): max difference **0.0013°**; the “Moon ≥ 10°” flag agrees in **721 / 721** hours.

### Sun & Earth / Compare engine — 52 / 52 checks PASS
`cd web && npx tsx tests/sky.test.ts` → `web/tests/sky_results.json`
* DSN table decodes to the same coverage as the Python builder (Goldstone 40.9 %, Madrid 40.1 %, Canberra 42.6 %, any complex 98.1 %).
* For each of the six regions: full-year sunlight and Earth line of sight at the named site match the pipeline's `regions.json` (within 1 point);
  30-day windows equal the existing Mission Command statistics; window lists add up to the percentages; contact ⊆ line of sight;
  energy = Σ 350 W × visible solar-disc fraction; point state equals the illumination engine; score within 0–100.

### Browser test of the new pages — 16 / 16 steps PASS
`python web/tests/e2e_v2.py http://localhost:4173/ OUT` (after `npm run build && npx vite preview`)
South Pole Map (cursor coordinates, region select, zoom and pan, add to compare, open site in another region) · Sun & Earth (time stepping, panorama,
hourly strips, window tables) · Compare (ranking with worked score, priority chips, CSV export with provenance, three synchronized charts, date mode with 4 dates) ·
all six original pages still open · phone width 390 px without horizontal scroll · no page errors. The original browser test (`tests/e2e_browser.py`) still passes 9 / 9.
