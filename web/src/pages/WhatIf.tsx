import { useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMission } from '../state';
import { MapView } from '../components/MapView';
import { Badge, Panel, Slider, Toggle, download } from '../components/ui';
import { fmtDate, hourToDate, idx } from '../engine/dataset';
import { evaluateSite, type SiteEval } from '../engine/sites';
import { planTraverse, type RouteResult } from '../engine/planner';
import { withPerturb } from '../engine/illum';
import { blockDisk, RouteTable } from './Planner';
import { routeSection, siteSection, whatIfReport } from '../report';

interface Run { site: SiteEval; route: RouteResult | null; blocked: Set<number>; startH: number; label: string }

const PRESETS = [
  { id: 'date', label: 'Landing date slips', desc: 'Delay landing by several days' },
  { id: 'shadow', label: 'Longer shadow period', desc: 'Terrain/DEM uncertainty raises the horizon' },
  { id: 'dte', label: 'Earth visibility interrupted', desc: 'Ground-station outage on day 2' },
  { id: 'route', label: 'Route becomes inaccessible', desc: 'Hazard blocks the middle of the planned route' },
  { id: 'power', label: 'Less solar energy', desc: 'Dust or degraded panels: −40% power' },
];

export function WhatIf() {
  const m = useMission(); const ds = m.ds;
  const [delayD, setDelayD] = useState(5);
  const [bias, setBias] = useState(0);
  const [outage, setOutage] = useState({ on: false, day: 2, hours: 48 });
  const [power, setPower] = useState(100);
  const [durD, setDurD] = useState(m.durDays);
  const [blockRoute, setBlockRoute] = useState(false);
  const [siteId, setSiteId] = useState(m.siteId);
  const [withRoute, setWithRoute] = useState(true);
  const [res, setRes] = useState<{ base: Run; scen: Run } | null>(null);
  const [busy, setBusy] = useState(false);

  const preset = (id: string) => {
    setDelayD(0); setBias(0); setOutage({ on: false, day: 2, hours: 48 }); setPower(100); setBlockRoute(false); setSiteId(m.siteId); setDurD(m.durDays);
    if (id === 'date') setDelayD(5); if (id === 'shadow') setBias(0.5); if (id === 'dte') setOutage({ on: true, day: 2, hours: 72 });
    if (id === 'route') setBlockRoute(true); if (id === 'power') setPower(60);
  };

  const run = () => { setBusy(true); setTimeout(() => {
    const dest = m.waypoints.slice(1);
    const baseRoute = withRoute && dest.length ? planTraverse(ds, [m.siteCell, ...dest], m.startH, m.rover).sunAware : null;
    const base: Run = { site: evaluateSite(ds, m.siteCell, m.startH, m.durDays * 24, m.lander, m.weights), route: baseRoute, blocked: new Set(), startH: m.startH, label: 'Baseline' };
    const s = m.sites.find(x => x.id === siteId) ?? m.sites[0]; const sCell = idx(ds, s.cell[0], s.cell[1]);
    const startH = Math.min(ds.hours - durD * 24 - 1, m.startH + delayD * 24);
    const blocked = new Set<number>();
    if (blockRoute && baseRoute?.steps.length) blockDisk(ds, baseRoute.steps[Math.floor(baseRoute.steps.length / 3)].cell, 300, blocked);
    const out = withPerturb({ horizonBiasDeg: bias, dteOutage: outage.on ? [startH + outage.day * 24, startH + outage.day * 24 + outage.hours] : null }, () => {
      const site = evaluateSite(ds, sCell, startH, durD * 24, m.lander, m.weights);
      const wp = [sCell, ...dest.map(d => (d === m.siteCell ? sCell : d))];
      const route = withRoute && dest.length ? planTraverse(ds, wp, startH, { ...m.rover, panelW: m.rover.panelW * power / 100 }, blocked).sunAware : null;
      return { site, route };
    });
    setRes({ base, scen: { ...out, blocked, startH, label: 'Scenario' } }); setBusy(false);
  }, 30); };

  const rows: [string, string, string, string][] = res ? (() => {
    const b = res.base, s = res.scen;
    const d = (x: number, y: number, u = '', inv = false) => { const v = y - x; const good = inv ? v < 0 : v > 0; return `${v >= 0 ? '+' : ''}${v.toFixed(1)}${u}${Math.abs(v) < 0.05 ? '' : good ? ' ▲' : ' ▼'}`; };
    return [
      ['Landing time', fmtDate(hourToDate(ds, b.startH)), fmtDate(hourToDate(ds, s.startH)), `${((s.startH - b.startH) / 24).toFixed(1)} d`],
      ['Overall site score', b.site.overall.toFixed(1), s.site.overall.toFixed(1), d(b.site.overall, s.site.overall)],
      ['Risk class', b.site.risk, s.site.risk, b.site.risk === s.site.risk ? '=' : 'changed'],
      ['Sun availability %', b.site.stats.sunPct.toFixed(1), s.site.stats.sunPct.toFixed(1), d(b.site.stats.sunPct, s.site.stats.sunPct, ' pt')],
      ['Longest darkness (h)', String(b.site.stats.longestDarkH), String(s.site.stats.longestDarkH), d(b.site.stats.longestDarkH, s.site.stats.longestDarkH, ' h', true)],
      ['Earth LOS %', b.site.stats.earthPct.toFixed(1), s.site.stats.earthPct.toFixed(1), d(b.site.stats.earthPct, s.site.stats.earthPct, ' pt')],
      ['Longest DTE blackout (h)', String(b.site.stats.longestBlackoutH), String(s.site.stats.longestBlackoutH), d(b.site.stats.longestBlackoutH, s.site.stats.longestBlackoutH, ' h', true)],
      ['Traverse', b.route ? (b.route.ok ? 'feasible' : 'infeasible') : '—', s.route ? (s.route.ok ? 'feasible' : 'infeasible') : '—', ''],
      ['Traverse duration (h)', b.route?.ok ? b.route.durationH.toFixed(1) : '—', s.route?.ok ? s.route.durationH.toFixed(1) : '—', b.route?.ok && s.route?.ok ? d(b.route.durationH, s.route.durationH, ' h', true) : ''],
      ['Min battery on traverse %', b.route?.ok ? b.route.minBatteryPct.toFixed(0) : '—', s.route?.ok ? s.route.minBatteryPct.toFixed(0) : '—', b.route?.ok && s.route?.ok ? d(b.route.minBatteryPct, s.route.minBatteryPct, ' pt') : ''],
    ];
  })() : [];

  const notes: string[] = res ? (() => {
    const b = res.base, s = res.scen, n: string[] = [];
    if (s.startH !== b.startH) n.push(`Landing ${((s.startH - b.startH) / 24).toFixed(0)} days later moves the Sun ${((s.startH - b.startH) / 24 * 360 / 29.53 % 360).toFixed(0)}° further around the horizon, so different ridges and crater rims cast the shadows.`);
    if (bias) n.push(`Raising every horizon by ${bias}° (DEM error / unresolved relief) changes Sun availability by ${(s.site.stats.sunPct - b.site.stats.sunPct).toFixed(1)} points — at the pole the Sun skims the horizon, so small terrain errors matter.`);
    if (outage.on) n.push(`A ${outage.hours} h ground-station outage starting day ${outage.day} sets the longest DTE blackout to ${s.site.stats.longestBlackoutH} h${m.rover.requireDTE ? '; the rover must wait because driving requires Earth contact' : ''}.`);
    if (power !== 100) n.push(`Solar output at ${power}% reduces recharge during traverse; minimum battery ${s.route?.ok ? s.route.minBatteryPct.toFixed(0) + '%' : 'not reached (route infeasible)'}.`);
    if (blockRoute) n.push(`A 300 m hazard zone was placed on the baseline route; the planner ${s.route?.ok ? `found a detour (${((s.route.lengthM - (b.route?.lengthM ?? 0)) / 1000).toFixed(2)} km longer)` : 'could not find an alternative'}.`);
    if (s.site.risk !== b.site.risk) n.push(`Site risk changes from ${b.site.risk} to ${s.site.risk}.`);
    if (s.route && !s.route.ok) n.push(`Scenario traverse fails: ${s.route.reason}`);
    if (!n.length) n.push('No change from baseline — adjust a parameter.');
    return n;
  })() : [];

  const sunSeries = res ? res.base.site.stats.series.map((p, k) => ({ h: p.h, base: p.sun, scen: res.scen.site.stats.series[k]?.sun })) : [];

  return (
    <div className="grid-landing">
      <Panel title="Scenario builder" className="side-l">
        <div className="chips">{PRESETS.map(p => <button key={p.id} className="chip" title={p.desc} onClick={() => preset(p.id)}>{p.label}</button>)}</div>
        <Slider label="Shift landing date" value={delayD} min={-10} max={20} onChange={setDelayD} unit=" d" />
        <Slider label="Mission duration" value={durD} min={1} max={30} onChange={setDurD} unit=" d" />
        <label className="selbox"><span>Landing site</span><select value={siteId} onChange={e => setSiteId(e.target.value)}>{m.sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <Slider label="Horizon uncertainty (raise horizon)" value={bias} min={-1} max={2} step={0.1} onChange={setBias} unit="°" />
        <Slider label="Available solar power" value={power} min={20} max={150} step={5} onChange={setPower} unit="%" />
        <Toggle label="Earth-link outage" value={outage.on} onChange={v => setOutage({ ...outage, on: v })} />
        {outage.on && <><Slider label="Outage starts on day" value={outage.day} min={0} max={durD} onChange={v => setOutage({ ...outage, day: v })} />
          <Slider label="Outage length" value={outage.hours} min={6} max={240} step={6} onChange={v => setOutage({ ...outage, hours: v })} unit=" h" /></>}
        <Toggle label="Planned route becomes inaccessible" value={blockRoute} onChange={setBlockRoute} />
        <Toggle label="Include rover traverse (from Planner)" value={withRoute} onChange={setWithRoute} />
        <button className="btn primary wide" disabled={busy} onClick={run}>{busy ? 'Simulating…' : 'Run scenario vs baseline'}</button>
        <p className="note">Baseline = current mission (site, date, duration, rover) from the other pages.</p>
      </Panel>
      <Panel title="Before ↔ after" className="span-main" right={res && <button className="btn ghost" onClick={() => download('LUNARIS_whatif_report.md', whatIfReport(ds, 'custom', rows, notes,
        [['## Baseline'], siteSection(ds, 'Baseline site', res.base.site), res.base.route ? routeSection(res.base.route) : [], ['## Scenario'], siteSection(ds, 'Scenario site', res.scen.site), res.scen.route ? routeSection(res.scen.route) : []]))}>⬇ Export report</button>}>
        {!res ? <p className="muted">Pick a preset or adjust parameters, then run. LUNARIS recomputes illumination, Earth visibility, site scores and the traverse for both cases.</p> : <>
          <table className="tbl"><thead><tr><th>Indicator</th><th>Baseline</th><th>Scenario</th><th>Change</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r[0]}><td className="muted">{r[0]}</td><td className="mono">{r[1]}</td><td className="mono">{r[2]}</td><td className="mono">{r[3]}</td></tr>)}</tbody></table>
          <h4>What changed and why</h4><ul className="bul">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <div className="row"><Badge tone="muted">Baseline risk</Badge> <Badge tone={res.base.site.risk === 'LOW' ? 'ok' : res.base.site.risk === 'MODERATE' ? 'warn' : 'bad'}>{res.base.site.risk}</Badge>
            <span className="muted">→</span> <Badge tone={res.scen.site.risk === 'LOW' ? 'ok' : res.scen.site.risk === 'MODERATE' ? 'warn' : 'bad'}>{res.scen.site.risk}</Badge></div>
        </>}
      </Panel>
      {res && <>
        <Panel title="Sunlight at the landing site — baseline vs scenario">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={sunSeries}><CartesianGrid stroke="#1f2630" /><XAxis dataKey="h" stroke="#8a9099" unit=" h" /><YAxis stroke="#8a9099" domain={[0, 1]} />
              <Tooltip contentStyle={{ background: '#15191F', border: '1px solid #2a313b' }} /><Legend />
              <Line type="stepAfter" dataKey="base" name="Baseline" stroke="#C7CBD1" dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="scen" name="Scenario" stroke="#E8B85C" dot={false} isAnimationActive={false} /></LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Routes — baseline (white, dashed) vs scenario (cyan)">
          <MapView layer="slope" hour={res.scen.startH} size={420} overlay={{ routes: [res.base.route ? { steps: res.base.route.steps, color: '#FFFFFF', dash: true } : null, res.scen.route ? { steps: res.scen.route.steps, color: '#58C7D9' } : null].filter(Boolean) as never, blocked: res.scen.blocked }} />
        </Panel>
        {res.base.route && res.scen.route && <Panel title="Traverse detail" className="span-all"><RouteTable rs={[{ ...res.base.route, name: 'Baseline (sun-aware)' }, { ...res.scen.route, name: 'Scenario (sun-aware)' }]} /></Panel>}
      </>}
    </div>
  );
}
