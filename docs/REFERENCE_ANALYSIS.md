# Reference review and v2 upgrade plan (14 November 2026)

## 1. Reference: Lunar Horizon / CLPS-MOON-BROWSER (localizedprojects, MIT)
Reviewed in the live web app (Compare page, guided tour) and from its public README. No code, text or design was copied.

| Area | What it does well | Limits we noted |
|---|---|---|
| Explore | Ranks ~19 preset south-pole sites (plus 20 sites elsewhere on the Moon) for a chosen period on a LOLA map | Ranking only — no landing hazard inside the ellipse |
| Site | Sky plot of the terrain skyline with Sun and Earth paths, timeline, light-and-shadow map, 3-D "lander's view", best 14-day landing window | One point at a time; no rover activity after landing |
| Compare | Shortlist of 2–4 sites; goals *Balanced / Power first / Earth contact first*; a winner card with the worked arithmetic; side-by-side bars (sunlight, Earth in view, both, longest dark); exact numbers; CSV with provenance | Compares places for one period; no date-vs-date view; communication is geometric |
| Settings | Period, observer (mast) height, Sun/Earth/DSN visibility rules | — |
| UX | Guided tours, plain-language answers first, phone layout | The tour overlay can block the page until dismissed |

Could not verify: internal algorithms beyond what the README states (we did not read or reuse its code).

## 2. Audit of LUNARIS before v2
Strong: real LOLA terrain + JPL DE421 Sun/Earth with two passed checks, landing-ellipse hazard scoring, sun-aware rover traverse with battery, departure windows, What-If.
Gaps against the challenge brief: no overview map of the whole pole; no single place showing Sun/Earth azimuth-elevation for a chosen hour; no communication windows list; no comparison across regions or dates; no DSN geometry.

## 3. Plan (priority order) and status
1. **Compare Sites** (sites across regions *and* dates, worked score, synchronized charts, CSV) — done.
2. **Sun & Earth dashboard** (az/el, skyline at that azimuth, disc fraction, LOS, DSN, panorama, windows, energy) — done.
3. **DSN geometry** from DE421 at Goldstone/Madrid/Canberra, validated against JPL Horizons — done (0.0013°).
4. **South Pole Map** (zoom/pan, coordinates, regions to scale, 40 m detail layers, add to compare) — done.
5. Navy/cyan visual refresh, grouped navigation, phone layout — done.
6. Tests: engine 52/52, browser 16/16, previous tests still pass — done.

Not done (future work): more regions (e.g. Shackleton rim, VIPER area) need new terrain patches; DSN antenna scheduling and link budget; lunar-orbit relays; boulder hazards from LROC NAC.
