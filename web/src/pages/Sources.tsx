import { useMission } from '../state';
import { Badge, Panel } from '../components/ui';

export function Sources() {
  const { ds } = useMission(); const m = ds.meta;
  return (
    <div className="grid-sources">
      <Panel title="Dataset provenance" className="span-all">
        <table className="tbl"><thead><tr><th>Item</th><th>Source</th><th>Resolution</th><th>Date</th><th>Status</th></tr></thead>
          <tbody>{m.provenance.map(p => <tr key={p.item}><td>{p.item}</td><td>{p.source}</td><td className="mono">{p.resolution}</td><td className="mono">{p.date}</td>
            <td>{p.real ? <Badge tone="ok">measured / authoritative</Badge> : <Badge tone="warn">computed or synthetic</Badge>}</td></tr>)}</tbody></table>
        {m.warnings.map((w, i) => <p key={i} className="note warn">⚠ {w}</p>)}
        <p className="note">Ephemeris: {ds.ephem.source} · {ds.hours} hourly samples from {ds.ephem.t0}. Grid: {m.width}×{m.height} @ {m.cellSize} m, {m.projection}. Observer height {m.observerHeightM} m.</p>
      </Panel>
      <Panel title="How each number is computed">
        <ul className="bul">
          <li><b>Horizon masks</b> — for every cell and 72 azimuths (5°), ray-marching over the DEM finds the maximum elevation angle of the terrain, including lunar curvature (d²/2R). A distant-horizon scan from a coarser, wider DEM is merged and re-referenced to each cell's height.</li>
          <li><b>Sunlight (terrain-aware)</b> — Sun azimuth/elevation from the ephemeris, corrected per cell for the local vertical; visible fraction of the 0.27° solar disc above the horizon mask. <i>Geometric</i> illumination ignores the mask.</li>
          <li><b>Earth line-of-sight</b> — Earth centre above the horizon mask (computed).</li>
          <li><b>DSN view</b> — for every hour, apparent Moon elevation at the three NASA Deep Space Network complexes (Goldstone, Madrid, Canberra; approximate WGS84 positions) from JPL DE421 with Skyfield; “sees the Moon” = elevation ≥ 10°.</li>
          <li><b>Contact possible</b> — Earth line of sight AND at least one DSN complex sees the Moon. Still geometry only: real contact also needs a free, scheduled antenna and a working link budget, which LUNARIS does not model.</li>
          <li><b>Solar energy</b> — panel power (rover setting, default 350 W) × visible fraction of the solar disc, summed hourly. Ideal Sun-tracking panel, no losses.</li>
          <li><b>Compare score</b> — Power = 0.6 × mean sunlight + 0.4 × night score; Contact = 0.6 × contact % + 0.4 × gap score; night and gap scores fall linearly from 100 (0 h) to 0 (7 days). Total = your weight × Power + (1 − weight) × Contact. Shown with its arithmetic on the Compare page.</li>
          <li><b>South Pole Map</b> — shaded relief of the LOLA 400 m south-pole DEM in polar stereographic projection; cursor coordinates use the exact inverse projection.</li>
          <li><b>PSR</b> — cells whose horizon is above the top of the solar disc for every Sun azimuth over the ephemeris span. Labelled <i>inferred</i>; not an ice detection.</li>
          <li><b>Slope / roughness</b> — central-difference gradient; roughness = local residual standard deviation (3×3).</li>
          <li><b>Site score</b> — weighted mean of six criteria with published formulas (Landing page column tooltips). Risk class from hard/soft thresholds.</li>
          <li><b>Traverse</b> — static A* vs. weighted time-dependent A* over (cell, hour, battery bucket). Energy: panel W × visible-disc fraction − drive/idle W.</li>
        </ul>
      </Panel>
      <Panel title="How we checked the numbers">
        <ul className="bul">
          <li><b>Sun and Earth directions</b> — compared with <b>JPL Horizons</b> (DE441, MEAN_ME) at the IM-2 Athena landing point, hourly for a full year (8 761 samples): max direction error <b>0.003°</b> for both (criterion &lt; 0.05°).</li>
          <li><b>Sunlight on real terrain</b> — Connecting Ridge (RoI 4), 2024–2026, 5 m above ground: LUNARIS <b>89.2 %</b> average visible Sun, longest shadow <b>3.5 days</b>; published value (Barker et al. 2021, Table 2): <b>88.1 %</b> and about 4 days. Pass criteria were fixed before running.</li>
          <li><b>DSN geometry</b> — Moon elevation from Goldstone compared with <b>JPL Horizons</b> (observer at the same coordinates, airless), hourly for January 2027 (721 samples): max difference <b>0.0013°</b>; the “≥ 10°” flag agreed in <b>721 / 721</b> hours.</li>
          <li>Rebuild and re-check offline: <code>python pipeline/validate_ephemeris.py</code>, <code>python pipeline/validate_illumination.py</code>, <code>python pipeline/build_open.py</code>, <code>python pipeline/build_extras.py</code>.</li>
        </ul>
        <p className="note">Terrain: NASA LRO LOLA (Barker et al. 2023 south-pole DEMs; LDEM_80S_80M). Open resampled patches from LUNAR//OPS (Apache-2.0) and Lunar Horizon (MIT) are credited in docs/DATA_SOURCES.md. LUNARIS adds the landing-hazard, traverse, battery and What-If analysis.</p>
      </Panel>
      <Panel title="Known limitations" className="span-all">
        <ul className="bul">
          <li>Terrain features smaller than ~2 grid cells (boulders, small craters) are not resolved; LROC NAC boulder maps are a planned integration.</li>
          <li>Solar power is modelled as an ideal Sun-tracking panel × visible-disc fraction; no thermal model, no panel temperature effects.</li>
          <li>Horizon azimuth resolution is 5°; near-grazing Sun timing is therefore approximate (minutes to an hour).</li>
          <li>Communication: no DSN antenna schedule, link budget, relay satellites or lunar-orbit relays are modelled — “contact possible” is an upper bound.</li>
          <li>Sun and Earth directions are computed once at each region's centre and corrected per cell for the local vertical; parallax across 8 km is below 0.01°.</li>
          <li>The sun-aware planner is bounded-suboptimal (weighted A*, ε = 1.4) to stay interactive.</li>
          <li>LUNARIS is an independent student prototype (NASA Space Apps 2026 — team Karak &amp; Cosmos). It is not affiliated with or endorsed by NASA.</li>
        </ul>
      </Panel>
    </div>
  );
}
