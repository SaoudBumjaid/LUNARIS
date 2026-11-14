import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMission } from '../state';
import { MapView } from '../components/MapView';
import { Badge, DateInput, Panel, Slider, Toggle, download } from '../components/ui';
import { cellLatLon, fmtDate, fmtLatLon, hourToDate, idx, rc } from '../engine/dataset';
import { planTraverse, type RouteResult } from '../engine/planner';
import { routeReport } from '../report';

export function blockDisk(ds: ReturnType<typeof useMission>['ds'], center: number, radiusM: number, set: Set<number>) {
  const [r0, c0] = rc(ds, center); const rr = Math.ceil(radiusM / ds.cell);
  for (let r = r0 - rr; r <= r0 + rr; r++) for (let c = c0 - rr; c <= c0 + rr; c++)
    if (r >= 0 && c >= 0 && r < ds.H && c < ds.W && Math.hypot(r - r0, c - c0) * ds.cell <= radiusM) set.add(idx(ds, r, c));
  return set;
}

export function batterySeries(a: RouteResult, b: RouteResult, cap: number) {
  const pts: Record<number, { t: number; a?: number; b?: number }> = {};
  const add = (r: RouteResult, k: 'a' | 'b') => { if (!r.steps.length) return; const t0 = r.steps[0].t; let last = -1;
    for (const s of r.steps) { const t = Math.round((s.t - t0) * 2) / 2; if (t === last) continue; last = t; (pts[t] ??= { t })[k] = +(100 * s.b / cap).toFixed(1); } };
  add(a, 'a'); add(b, 'b');
  return Object.values(pts).sort((x, y) => x.t - y.t);
}

export function RouteTable({ rs }: { rs: RouteResult[] }) {
  const rows: [string, (r: RouteResult) => string][] = [
    ['Status', r => (r.ok ? 'Feasible' : 'Infeasible')], ['Length', r => `${(r.lengthM / 1000).toFixed(2)} km`],
    ['Total duration', r => `${r.durationH.toFixed(1)} h`], ['Driving / waiting', r => `${r.driveH.toFixed(1)} h / ${r.waitH.toFixed(1)} h`],
    ['Driving in darkness', r => `${r.darkDriveH.toFixed(1)} h`], ['Min / end battery', r => `${r.minBatteryPct.toFixed(0)}% / ${r.endBatteryPct.toFixed(0)}%`],
    ['Earth LOS during traverse', r => `${r.earthPct.toFixed(0)}%`], ['Max slope on route', r => `${r.maxSlope.toFixed(1)}°`],
  ];
  return (
    <table className="tbl"><thead><tr><th></th>{rs.map(r => <th key={r.name}>{r.name}</th>)}</tr></thead>
      <tbody>{rows.map(([k, f]) => <tr key={k}><td className="muted">{k}</td>{rs.map(r => <td key={r.name} className="mono">{k === 'Status' ? <Badge tone={r.ok ? 'ok' : 'bad'}>{f(r)}</Badge> : f(r)}</td>)}</tr>)}
        <tr><td className="muted">Reason</td>{rs.map(r => <td key={r.name} className="small">{r.reason ?? '—'}</td>)}</tr></tbody></table>
  );
}

export function Planner() {
  const m = useMission(); const ds = m.ds;
  const [mode, setMode] = useState<'none' | 'add' | 'block'>('none');
  const [blocked, setBlocked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [ret, setRet] = useState(true);
  const dest = ret ? m.waypoints.slice(1, -1) : m.waypoints.slice(1);
  const setDest = (d: number[], r = ret) => m.setWaypoints(r ? [m.siteCell, ...d, m.siteCell] : [m.siteCell, ...d]);
  const run = () => { setBusy(true); setTimeout(() => { m.setRoutes(planTraverse(ds, [m.siteCell, ...dest, ...(ret ? [m.siteCell] : [])], m.startH, m.rover, blocked)); setBusy(false); }, 30); };
  const [scan, setScan] = useState<{ h: number; s: boolean; a: boolean; dur: number }[] | null>(null);
  const [scanProg, setScanProg] = useState(0);
  const runScan = () => {
    const wp = [m.siteCell, ...dest, ...(ret ? [m.siteCell] : [])]; const out: NonNullable<typeof scan> = []; const step = 12, n = 60;
    setScan([]); let k = 0;
    const tick = () => {
      const h = m.startH + k * step; if (k >= n || h >= ds.hours) { setScan([...out]); setScanProg(0); return; }
      const r = planTraverse(ds, wp, h, m.rover, blocked, 60000);
      out.push({ h, s: r.shortest.ok, a: r.sunAware.ok, dur: r.sunAware.ok ? r.sunAware.durationH : 0 }); k++; setScanProg(k / n); setScan([...out]); setTimeout(tick, 0);
    };
    tick();
  };
  const R = m.routes;
  const series = useMemo(() => (R ? batterySeries(R.shortest, R.sunAware, m.rover.batteryWh) : []), [R, m.rover.batteryWh]);
  const p = m.rover, set = (k: keyof typeof p, v: number | boolean) => m.setRover({ ...p, [k]: v });

  return (
    <div className="grid-landing">
      <Panel title="Traverse map" right={<div className="seg">
        <button className={mode === 'add' ? 'on' : ''} onClick={() => setMode(mode === 'add' ? 'none' : 'add')}>＋ Destination</button>
        <button className={mode === 'block' ? 'on' : ''} onClick={() => setMode(mode === 'block' ? 'none' : 'block')}>⛔ Block area</button>
        <button onClick={() => setBlocked(new Set())}>Clear blocks</button></div>}>
        <MapView layer={m.layer === 'elevation' ? 'slope' : m.layer} hour={m.startH} size={500}
          overlay={{ routes: R ? [{ steps: R.shortest.steps, color: '#F59E0B', dash: true }, { steps: R.sunAware.steps, color: '#58C7D9' }] : [], waypoints: [m.siteCell, ...dest], blocked }}
          onPick={c => { if (mode === 'add') setDest([...dest, c]); if (mode === 'block') setBlocked(new Set(blockDisk(ds, c, 250, new Set(blocked)))); }} />
        <p className="note"><span style={{ color: '#58C7D9' }}>━ Sun-aware route</span> · <span style={{ color: '#F59E0B' }}>┅ Shortest route</span> · dots = waiting (recharge / sunrise / Earth contact) · red = blocked area. Map shows the layer chosen in Explorer at the mission start time.</p>
      </Panel>
      <div className="side">
        <Panel title="Route">
          <div className="kv"><span>Start (landing site)</span><b>{m.sites.find(s => s.id === m.siteId)?.name}</b></div>
          {dest.map((d, k) => <div key={k} className="kv"><span>Destination {k + 1}</span><b className="mono small">{fmtLatLon(...cellLatLon(ds, d))} <button className="x" onClick={() => setDest(dest.filter((_, j) => j !== k))}>✕</button></b></div>)}
          <div className="chips">{ds.meta.targets.map(t => <button key={t.id} className="chip" onClick={() => setDest([...dest, idx(ds, t.edgeCell[0], t.edgeCell[1])])}>＋ {t.id} edge</button>)}</div>
          <Toggle label="Return to landing site" value={ret} onChange={v => { setRet(v); setDest(dest, v); }} />
          <DateInput label="Departure (= landing time)" hour={m.startH} onChange={h => { m.setStartH(h); m.setHour(h); }} />
          <button className="btn primary wide" disabled={busy || !dest.length} onClick={run}>{busy ? 'Planning…' : 'Plan & compare routes'}</button>
        </Panel>
        <Panel title="Rover assumptions (editable)">
          <Slider label="Speed" value={p.speedMps} min={0.02} max={0.5} step={0.01} onChange={v => set('speedMps', v)} unit=" m/s" />
          <Slider label="Max traversable slope" value={p.maxSlope} min={8} max={30} onChange={v => set('maxSlope', v)} unit="°" />
          <Slider label="Solar panel output (full Sun)" value={p.panelW} min={50} max={1000} step={10} onChange={v => set('panelW', v)} unit=" W" />
          <Slider label="Driving power" value={p.driveW} min={50} max={800} step={10} onChange={v => set('driveW', v)} unit=" W" />
          <Slider label="Idle / survival power" value={p.idleW} min={10} max={300} step={5} onChange={v => set('idleW', v)} unit=" W" />
          <Slider label="Battery capacity" value={p.batteryWh} min={500} max={8000} step={100} onChange={v => set('batteryWh', v)} unit=" Wh" />
          <Slider label="Battery reserve" value={p.reservePct} min={0} max={50} onChange={v => set('reservePct', v)} unit="%" />
          <Toggle label="Drive only with Earth line-of-sight" value={p.requireDTE} onChange={v => set('requireDTE', v)} />
        </Panel>
      </div>
      <Panel title="Departure windows (next 30 days, every 12 h)" className="span-all" right={<button className="btn" disabled={!dest.length || scanProg > 0} onClick={runScan}>{scanProg > 0 ? `Scanning… ${(scanProg * 100).toFixed(0)}%` : 'Find departure windows'}</button>}>
        {scan?.length ? <>
          <div className="windows">{scan.map(x => <button key={x.h} title={`${fmtDate(hourToDate(ds, x.h))} — shortest ${x.s ? 'OK' : 'fails'}, sun-aware ${x.a ? 'OK (' + x.dur.toFixed(0) + ' h)' : 'fails'}`}
            className={x.a ? (x.s ? 'w ok' : 'w only') : 'w no'} onClick={() => { m.setStartH(x.h); m.setHour(x.h); }} />)}</div>
          <p className="note"><span className="lg ok" /> both routes feasible · <span className="lg only" /> only the sun-aware planner succeeds (timing/waiting matters) · <span className="lg no" /> infeasible. Click a slot to set the departure time.</p>
        </> : <p className="muted">Runs both planners for each departure slot to reveal when the traverse is possible as shadows rotate around the pole.</p>}
      </Panel>
      {R && <>
        <Panel title="Route comparison" className="span-all" right={<button className="btn ghost" onClick={() => download('LUNARIS_traverse_report.md', routeReport(ds, m, R, blocked.size))}>⬇ Export report</button>}>
          <RouteTable rs={[R.shortest, R.sunAware]} />
          <p className="note">Shortest path ignores time: it is simulated driving straight through, without waiting. The sun-aware planner searches space × time (moving shadows, hourly) and may wait to recharge or for sunrise. Departure {fmtDate(hourToDate(ds, m.startH))}.</p>
        </Panel>
        <Panel title="Battery state of charge along each route" className="span-all">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series}><CartesianGrid stroke="#1f2630" /><XAxis dataKey="t" type="number" stroke="#8a9099" unit=" h" /><YAxis stroke="#8a9099" domain={[0, 100]} unit="%" />
              <Tooltip contentStyle={{ background: '#15191F', border: '1px solid #2a313b' }} /><Legend />
              <Line dataKey="a" name="Shortest" stroke="#F59E0B" dot={false} connectNulls isAnimationActive={false} />
              <Line dataKey="b" name="Sun-aware" stroke="#58C7D9" dot={false} connectNulls isAnimationActive={false} /></LineChart>
          </ResponsiveContainer>
        </Panel>
      </>}
    </div>
  );
}
