import { useMemo } from 'react';
import { useMission } from '../state';
import { MapView } from '../components/MapView';
import { Badge, Panel, Stat, riskTone, scoreTone } from '../components/ui';
import { cellLatLon, fmtDate, fmtLatLon, hourToDate, idx } from '../engine/dataset';
import { evaluateSite } from '../engine/sites';

export function Overview({ go }: { go: (p: string) => void }) {
  const m = useMission(); const ds = m.ds; const dur = m.durDays * 24;
  const evals = useMemo(() => m.sites.map(s => ({ s, e: evaluateSite(ds, idx(ds, s.cell[0], s.cell[1]), m.startH, dur, m.lander, m.weights) })), [ds, m.sites, m.startH, dur, m.lander, m.weights]);
  const cur = evals.find(x => x.s.id === m.siteId) ?? evals[0];
  const r = m.routes?.sunAware;
  const [la, lo] = [ds.meta.center.lat, ds.meta.center.lon];
  let psrArea = 0; for (const t of ds.meta.targets) psrArea += t.areaKm2;
  return (
    <div className="grid-overview">
      <Panel title="Selected region" className="span2">
        <div className="kv"><span>Region</span><b>{ds.meta.regionName}</b></div>
        <div className="kv"><span>Centre</span><b className="mono">{fmtLatLon(la, lo)}</b></div>
        <div className="kv"><span>Extent</span><b>{(ds.W * ds.cell / 1000).toFixed(1)} × {(ds.H * ds.cell / 1000).toFixed(1)} km @ {ds.cell} m</b></div>
        <div className="kv"><span>Mission window</span><b>{fmtDate(hourToDate(ds, m.startH))} + {m.durDays} d</b></div>
        <div className="kv"><span>Data</span><b>{ds.meta.mode === 'demo' ? <Badge tone="warn">DEMO · synthetic</Badge> : <Badge tone="ok">NASA LOLA + JPL DE421 (checked vs JPL Horizons)</Badge>}</b></div>
      </Panel>
      <Panel title="Mission status" className="span2">
        <div className="stats4">
          <Stat label="Landing site score" value={cur ? cur.e.overall.toFixed(0) : '—'} unit="/100" tone={cur ? scoreTone(cur.e.overall) : undefined} />
          <Stat label="Sun at site" value={cur ? cur.e.stats.sunPct.toFixed(0) : '—'} unit="%" tone="info" />
          <Stat label="Earth LOS" value={cur ? cur.e.stats.earthPct.toFixed(0) : '—'} unit="%" tone="info" />
          <Stat label="Traverse" value={r ? (r.ok ? 'FEASIBLE' : 'BLOCKED') : 'NOT PLANNED'} tone={r ? (r.ok ? 'ok' : 'bad') : undefined} />
        </div>
      </Panel>
      <Panel title="Region map" right={<button className="btn ghost" onClick={() => go('explorer')}>Open 3-D explorer →</button>} className="span2 row2">
        <MapView size={460} overlay={{ routes: m.routes ? [{ steps: m.routes.sunAware.steps, color: '#58C7D9' }] : [], ellipse: { cell: m.siteCell, radiusM: m.lander.ellipseRadiusM } }} />
      </Panel>
      <Panel title="Candidate landing sites" right={<button className="btn ghost" onClick={() => go('landing')}>Evaluate →</button>} className="span2">
        <table className="tbl"><thead><tr><th>Site</th><th>Score</th><th>Risk</th><th>Sun</th><th>Earth</th><th>Longest dark</th></tr></thead>
          <tbody>{evals.map(({ s, e }) => (
            <tr key={s.id} className={s.id === m.siteId ? 'sel' : ''} onClick={() => m.setSiteId(s.id)}>
              <td>{s.name}<div className="muted mono small">{fmtLatLon(...cellLatLon(ds, idx(ds, s.cell[0], s.cell[1])))}</div></td>
              <td className="mono">{e.overall.toFixed(0)}</td><td><Badge tone={riskTone(e.risk)}>{e.risk}</Badge></td>
              <td className="mono">{e.stats.sunPct.toFixed(0)}%</td><td className="mono">{e.stats.earthPct.toFixed(0)}%</td><td className="mono">{e.stats.longestDarkH} h</td>
            </tr>))}</tbody></table>
      </Panel>
      <Panel title="Science points of interest" right={<button className="btn ghost" onClick={() => go('planner')}>Plan traverse →</button>}>
        <div className="kv"><span>Computed PSRs (largest)</span><b>{ds.meta.targets.length} · {psrArea.toFixed(1)} km²</b></div>
        {ds.meta.targets.map(t => <div key={t.id} className="kv"><span>{t.id}</span><b>{t.areaKm2} km² <Badge tone="muted">{t.status}</Badge></b></div>)}
        <p className="note">PSRs are computed from terrain + ephemeris. They mark potential cold traps — not confirmed water ice.</p>
      </Panel>
      <Panel title="Risk & confidence">
        {cur && <ul className="bul">{cur.e.explanation.slice(0, 5).map((x, i) => <li key={i}>{x}</li>)}</ul>}
        {ds.meta.warnings.map((w, i) => <p key={i} className="note warn">{w}</p>)}
      </Panel>
    </div>
  );
}
