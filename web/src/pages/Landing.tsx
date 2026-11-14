import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, Legend } from 'recharts';
import { useMission } from '../state';
import { MapView } from '../components/MapView';
import { Badge, DateInput, Panel, ScoreBar, Slider, riskTone } from '../components/ui';
import { cellLatLon, fmtDate, fmtLatLon, hourToDate, idx } from '../engine/dataset';
import { CRITERIA, evaluateSite } from '../engine/sites';

const COLORS = ['#E8B85C', '#58C7D9', '#C7CBD1', '#A78BFA', '#F59E0B', '#34D399'];

export function Landing() {
  const m = useMission(); const ds = m.ds; const dur = m.durDays * 24;
  const [addMode, setAddMode] = useState(false);
  const evals = useMemo(() => m.sites.map(s => ({ s, e: evaluateSite(ds, idx(ds, s.cell[0], s.cell[1]), m.startH, dur, m.lander, m.weights) })), [ds, m.sites, m.startH, dur, m.lander, m.weights]);
  const sel = evals.find(x => x.s.id === m.siteId) ?? evals[0];
  const [scan, setScan] = useState<{ h: number; date: string; score: number; sun: number; earth: number }[] | null>(null);

  const runScan = () => {
    const out: NonNullable<typeof scan> = [];
    for (let h = 0; h + dur < ds.hours && h <= 90 * 24; h += 12) {
      const e = evaluateSite(ds, m.siteCell, h, dur, m.lander, m.weights);
      out.push({ h, date: fmtDate(hourToDate(ds, h)).slice(0, 10), score: +e.overall.toFixed(1), sun: +e.stats.sunPct.toFixed(1), earth: +e.stats.earthPct.toFixed(1) });
    }
    setScan(out);
  };
  const best = scan?.reduce((a, b) => (b.score > a.score ? b : a));
  const radar = CRITERIA.map(c => Object.fromEntries([['k', c.label], ...evals.map(({ s, e }) => [s.name, +e.scores[c.key].toFixed(0)])]));

  return (
    <div className="grid-landing">
      <Panel title="Landing site map" right={<button className={`btn ${addMode ? 'on' : 'ghost'}`} onClick={() => setAddMode(!addMode)}>{addMode ? 'Click map to add site…' : '＋ Add site'}</button>}>
        <MapView layer="hazard" size={480} overlay={{ ellipse: { cell: m.siteCell, radiusM: m.lander.ellipseRadiusM } }}
          onPick={c => {
            if (addMode) { const id = `user-${Date.now()}`; m.setSites([...m.sites, { id, name: `User site ${m.sites.length + 1}`, cell: [Math.floor(c / ds.W), c % ds.W], origin: 'user-picked' }]); m.setSiteId(id); setAddMode(false); }
            else { const near = m.sites.find(s => Math.hypot(s.cell[0] - Math.floor(c / ds.W), s.cell[1] - c % ds.W) < 6); if (near) m.setSiteId(near.id); }
          }} />
        <p className="note">Layer: landing hazard (red = slope above lander limit or rough). Dashed circle = landing dispersion ellipse.</p>
      </Panel>
      <div className="side">
        <Panel title="Mission & lander assumptions">
          <DateInput label="Landing time (UTC)" hour={m.startH} onChange={h => { m.setStartH(h); m.setHour(h); }} />
          <Slider label="Surface mission duration" value={m.durDays} min={1} max={30} onChange={m.setDurDays} unit=" d" />
          <Slider label="Landing ellipse radius" value={m.lander.ellipseRadiusM} min={50} max={500} step={10} onChange={v => m.setLander({ ...m.lander, ellipseRadiusM: v })} unit=" m" />
          <Slider label="Lander max slope" value={m.lander.maxLanderSlope} min={5} max={20} onChange={v => m.setLander({ ...m.lander, maxLanderSlope: v })} unit="°" />
          <Slider label="Battery survives darkness for" value={m.lander.batteryNightH} min={6} max={200} step={2} onChange={v => m.setLander({ ...m.lander, batteryNightH: v })} unit=" h" />
          <Slider label="Required Earth line-of-sight" value={m.lander.minEarthPct} min={0} max={100} step={5} onChange={v => m.setLander({ ...m.lander, minEarthPct: v })} unit="%" />
        </Panel>
        <Panel title="Criterion weights (your priorities)">
          {CRITERIA.map(c => <Slider key={c.key} label={c.label} value={m.weights[c.key]} min={0} max={5} onChange={v => m.setWeights({ ...m.weights, [c.key]: v })} />)}
        </Panel>
      </div>
      <Panel title="Site comparison" className="span-all">
        <table className="tbl">
          <thead><tr><th>Site</th><th>Overall</th><th>Risk</th>{CRITERIA.map(c => <th key={c.key} title={c.formula}>{c.label}</th>)}</tr></thead>
          <tbody>{evals.map(({ s, e }) => (
            <tr key={s.id} className={s.id === m.siteId ? 'sel' : ''} onClick={() => m.setSiteId(s.id)}>
              <td>{s.name}<div className="muted small">{s.origin}</div></td>
              <td className="mono big">{e.overall.toFixed(0)}</td><td><Badge tone={riskTone(e.risk)}>{e.risk}</Badge></td>
              {CRITERIA.map(c => <td key={c.key}><div className="mono small">{e.scores[c.key].toFixed(0)}</div><ScoreBar value={e.scores[c.key]} /></td>)}
            </tr>))}</tbody>
        </table>
        <p className="note">Hover a column header to see its exact formula. Overall = weighted mean of criteria. This is a transparent planning aid — not an official landing-safety certification.</p>
      </Panel>
      {sel && <Panel title={<>Why: {sel.s.name} <span className="muted mono small">{fmtLatLon(...cellLatLon(ds, idx(ds, sel.s.cell[0], sel.s.cell[1])))}</span></>}>
        <ul className="bul">{sel.e.explanation.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <div className="evidence">{Object.entries(sel.e.evidence).map(([k, v]) => <div key={k}><span>{k}</span><b className="mono">{v}</b></div>)}</div>
      </Panel>}
      <Panel title="Criteria profile">
        <ResponsiveContainer width="100%" height={300}>
          <RadarChart data={radar} outerRadius="62%"><PolarGrid stroke="#2a313b" /><PolarAngleAxis dataKey="k" tick={{ fill: '#8a9099', fontSize: 10 }} /><PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            {evals.map(({ s }, i) => <Radar key={s.id} dataKey={s.name} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={s.id === m.siteId ? 0.25 : 0.05} isAnimationActive={false} />)}
            <Legend wrapperStyle={{ fontSize: 11 }} /></RadarChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="Best landing window for the selected site" className="span-all" right={<button className="btn" onClick={runScan}>Scan next 90 days</button>}>
        {scan ? <>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={scan}><CartesianGrid stroke="#1f2630" /><XAxis dataKey="date" stroke="#8a9099" minTickGap={40} /><YAxis stroke="#8a9099" domain={[0, 100]} />
              <Tooltip contentStyle={{ background: '#15191F', border: '1px solid #2a313b' }} />
              <Line dataKey="score" name="Overall score" stroke="#E8B85C" dot={false} isAnimationActive={false} />
              <Line dataKey="sun" name="Sun %" stroke="#a8814a" dot={false} strokeDasharray="4 3" isAnimationActive={false} />
              <Line dataKey="earth" name="Earth %" stroke="#58C7D9" dot={false} strokeDasharray="4 3" isAnimationActive={false} /></LineChart>
          </ResponsiveContainer>
          {best && <p>Best start in scan: <b className="mono">{fmtDate(hourToDate(ds, best.h))}</b> → score {best.score} (sun {best.sun}%, Earth {best.earth}%). <button className="btn ghost" onClick={() => { m.setStartH(best.h); m.setHour(best.h); }}>Use this date</button></p>}
        </> : <p className="muted">Evaluates the site for every 12-hour landing slot over 90 days with the current duration, assumptions and weights.</p>}
      </Panel>
    </div>
  );
}
