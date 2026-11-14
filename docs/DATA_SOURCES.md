# LUNARIS — data sources and what is real

| Item | Source | Resolution | Real or computed |
|---|---|---|---|
| Terrain near each site (8 × 8 km) | NASA LRO **LOLA** south-pole DEMs (Barker et al. 2023, NASA GSFC PGDA), resampled to a 20 m local east/north grid by the open-source LUNAR//OPS project (Apache-2.0) | 20 m patch → slope at 20 m → 40 m analysis grid | Measured (NASA) |
| Terrain to 300 km (far horizon) | NASA LRO **LOLA** LDEM_80S_80M + LDEM_75S_120M, 400 m block means from the open-source Lunar Horizon project (MIT) | 400 m | Measured (NASA) |
| Sun and Earth directions | **JPL DE421** planetary ephemeris (via Skyfield) + **IAU 2009** lunar rotation model (Archinal et al. 2011), computed by LUNARIS | hourly, 2027 | Computed from JPL data; checked against **JPL Horizons** (max error 0.003°) |
| Site coordinates | Barker et al. 2021 (Connecting Ridge RoI 4), LROC/press coordinates (IM-2 Athena), PGDA illumination maxima within NASA 5 m DEM tiles (Malapert, Nobile Rim 1/2, Haworth) — as cited in `pipeline/data/third_party/lunar_ops/sites.json` | — | Published |
| Horizons, sunlight %, Earth line-of-sight %, permanently shadowed regions, slope, roughness, candidate sites, PSR targets | **Computed by LUNARIS** (`pipeline/lunaris/core.py`, `pipeline/build_open.py`) | 40 m, 72 azimuths | Computed |
| South Pole Map (shaded relief, 400 km × 400 km) | NASA LRO **LOLA** 400 m south-pole DEM (via Lunar Horizon, MIT), shaded by LUNARIS (`pipeline/build_extras.py`) | 400 m | Measured terrain, computed shading |
| DSN view of the Moon (Goldstone, Madrid, Canberra) | **JPL DE421** + Skyfield, approximate WGS84 complex positions, Moon ≥ 10°, hourly 2027 (`pipeline/build_extras.py` → `web/public/data/dsn.json`) | hourly | Computed; checked against **JPL Horizons** (max 0.0013°, 721/721 hours agree) |
| Site scores, routes, battery, departure windows, What-If | **Computed by LUNARIS** in the browser (`web/src/engine/`) | per cell, hourly | Computed |

## Not modelled (honest limits)
* Boulders and craters smaller than ~40 m (no LROC NAC boulder maps yet).
* Radio link budget and DSN antenna schedules. LUNARIS separates three levels: Earth line of sight (computed), a DSN complex sees the Moon (computed), real contact (needs a scheduled antenna — not modelled). “Contact possible” is therefore an upper bound.
* Earth orientation for 2027 uses Skyfield's built-in predictions (the bundled IERS table ends earlier); effect on a 10° elevation threshold is negligible (Horizons check above).
* Thermal model, dust, panel temperature; the panel is an ideal Sun-tracking panel × visible-disc fraction.
* PSRs are from one year of geometry: potential cold traps, **not** confirmed ice.
* Not flight software. Not endorsed by NASA.

## References
* Barker, M.K. et al. (2021) Improved LOLA elevation maps for south pole landing sites. *Planet. Space Sci.* 203, 105119. doi:10.1016/j.pss.2020.105119
* Barker, M.K. et al. (2023) *Planet. Sci. J.* 4, 183. doi:10.3847/PSJ/acf3e1; data doi:10.60903/gsfcpgda-lola-spole
* Smith, D.E. et al. (2010) The Lunar Orbiter Laser Altimeter investigation on LRO. *Space Sci. Rev.* 150, 209–241.
* Folkner, W.M. et al. (2008) The Planetary and Lunar Ephemeris DE421. JPL IOM 343R-08-003.
* Archinal, B.A. et al. (2011) Report of the IAU WGCCRE: 2009. *Celest. Mech. Dyn. Astr.* 109, 101–135.
* Mazarico, E. et al. (2011) Illumination conditions of the lunar polar regions using LOLA topography. *Icarus* 211, 1066–1081.
* JPL Horizons System, ssd.jpl.nasa.gov/horizons
* Rhodes, B. (2019) Skyfield: high precision research-grade positions. Astrophysics Source Code Library ascl:1907.024.
