# Third-party open data used by LUNARIS

These files are open, permissively licensed derivatives of NASA data. LUNARIS uses them as inputs only.
All analysis (horizons, sunlight, Earth view, PSR, slope hazard, traverse planning, batteries, What-If)
is computed by LUNARIS's own code.

| Folder | What | Original NASA data | Licence of the derivative |
|---|---|---|---|
| `lunar_ops/terrain_<site>.bin.gz`, `sites.json` | 8 × 8 km height patches, 20 m grid, local east/north, around six south-pole sites; site coordinates with citations | NASA LRO LOLA south-pole DEMs (Barker et al. 2023, NASA GSFC PGDA), 5–10 m | Apache-2.0, LUNAR//OPS project (github.com/RootVandal/lunar-ops), see `lunar_ops/LICENSE` |
| `lunar_horizon/dem_400m.bin.gz`, `map.json` | 400 m height grid of 75–90° S, polar stereographic | NASA LRO LOLA LDEM_80S_80M + LDEM_75S_120M (PDS) | MIT, Lunar Horizon project (github.com/localizedprojects/CLPS-MOON-BROWSER), see `lunar_horizon/LICENSE` |

Validation references in `pipeline/validation/`:
* `jpl_horizons/sun_im2.txt`, `earth_im2.txt` — JPL Horizons API output (DE441, MEAN_ME), as stored in LUNAR//OPS test fixtures.
* `validation_barker2021_z*.json` — published values from Barker et al. (2021), Table 2 (we use only the `published` fields).
