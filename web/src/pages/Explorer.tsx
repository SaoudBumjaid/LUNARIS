import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Scatter, ComposedChart, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { useMission } from '../state';
import { Terrain3D } from '../components/Terrain3D';
import { MapView } from '../components/MapView';
import { Panel, Slider, Stat } from '../components/ui';
import { LAYERS, type LayerKey } from '../engine/layers';
import { cellLatLon, fmtDate, fmtLatLon, hourToDate } from '../engine/dataset';
import { earthVis, horizonAt, sunElGeom, sunFrac, windowStats } from '../engine/illum';

export function Explorer() {
  const m = useMission(); const ds = m.ds;
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const [exag, setExag] = useState(2);
  const [play, setPlay] = useState(false);
  useEffect(() => { if (!play) return; const id = setInterval(() => m.setHour(Math.min(ds.hours - 1, m.hour + 2)), 120); return () => clearInterval(id); }, [play, m, ds]);
  const cell = m.selected ?? m.siteCell;
  const routes = m.routes ? [{ steps: m.routes.sunAware.steps, color: '#58C7D9' }, { steps: m.routes.shortest.steps, color: '#F59E0B' }] : [];

  const sky = useMemo(() => {
    const hz = Array.from({ length: 73 }, (_, k) => ({ az: k * 5, horizon: +horizonAt(ds, cell, k * 5).toFixed(2) }));
    const sun: { az: number; el: number }[] = [], earth: { az: number; el: number }[] = [];
    for (let h = m.startH; h < Math.min(ds.hours, m.startH + 30 * 24); h += 4) {
      const t = Math.floor(h);
      sun.push({ az: +ds.ephem.sunAz[t].toFixed(1), el: +sunElGeom(ds, cell, h).toFixed(2) });
      earth.push({ az: +ds.ephem.earthAz[t].toFixed(1), el: +(ds.ephem.earthEl[t]).toFixed(2) });
    }
    return { hz, sun, earth };
  }, [ds, cell, m.startH]);
  const st = useMemo(() => windowStats(ds, cell, m.startH, m.durDays * 24, 6), [ds, cell, m.startH, m.durDays]);
  const geomSunPct = useMemo(() => { let n = 0, k = 0; for (let h = m.startH; h < Math.min(ds.hours, m.startH + m.durDays * 24); h++, k++) if (sunElGeom(ds, cell, h) > 0) n++; return 100 * n / Math.max(1, k); }, [ds, cell, m.startH, m.durDays]);
  const [la, lo] = cellLatLon(ds, cell);

  return (
    <div className="grid-explorer">
      <Panel title={<>Lunar Explorer <span className="muted">· {ds.meta.regionName}</span></>} className="viewport"
        right={<div className="seg"><button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>3-D</button><button className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')}>2-D map</button></div>}>
        <div className="vp">{view === '3d'
          ? <Terrain3D layer={m.layer} hour={m.hour} exag={exag} routes={routes} onPick={c => m.setSelected(c)} />
          : <div className="center"><MapView size={620} onPick={() => {}} overlay={{ routes }} /></div>}
        </div>
        <div className="vp-foot">
          <button className="btn" onClick={() => setPlay(!play)}>{play ? '❚❚ Pause' : '▶ Animate shadows'}</button>
          <div className="grow"><Slider label="Display time" value={m.hour} min={0} max={ds.hours - 1} onChange={m.setHour} fmt={h => fmtDate(hourToDate(ds, h))} /></div>
          {view === '3d' && <div style={{ width: 160 }}><Slider label="Vertical ×" value={exag} min={1} max={6} step={0.5} onChange={setExag} /></div>}
        </div>
        <p className="note">{view === '3d' ? 'Drag to orbit · scroll to zoom · double-click terrain to inspect. ' : 'Click to inspect. '}
          Colours come from LUNARIS computations (horizon masks). The 3-D light is a visual cue only; terrain-aware shadows are the colour layer “Sunlight at selected time”.</p>
      </Panel>
      <div className="side">
        <Panel title="Data layers">
          {LAYERS.map(l => <label key={l.key} className="radio"><input type="radio" checked={m.layer === l.key} onChange={() => m.setLayer(l.key as LayerKey)} /><span>{l.label}<small>{l.legend}</small></span></label>)}
        </Panel>
        <Panel title="Inspector">
          <div className="kv"><span>Location</span><b className="mono">{fmtLatLon(la, lo)}</b></div>
          <div className="kv"><span>Elevation / slope</span><b className="mono">{ds.elev[cell].toFixed(0)} m · {ds.slope[cell].toFixed(1)}°</b></div>
          <div className="kv"><span>Now</span><b>Sun {(sunFrac(ds, cell, m.hour) * 100).toFixed(0)}% · DTE {earthVis(ds, cell, m.hour) ? 'yes' : 'no'}{ds.psr[cell] ? ' · PSR' : ''}</b></div>
          <div className="stats2">
            <Stat label="Sun (terrain-aware)" value={st.sunPct.toFixed(0)} unit="%" tone="info" />
            <Stat label="Sun (geometric only)" value={geomSunPct.toFixed(0)} unit="%" />
            <Stat label="Longest darkness" value={st.longestDarkH} unit=" h" tone={st.longestDarkH > m.lander.batteryNightH ? 'bad' : 'ok'} />
            <Stat label="Earth LOS" value={st.earthPct.toFixed(0)} unit="%" tone="info" />
          </div>
          <p className="note">“Geometric” ignores terrain (Sun above the mathematical horizon). The gap between the two numbers is what the terrain costs you.</p>
        </Panel>
      </div>
      <Panel title="Skyline at inspected point — terrain horizon vs Sun & Earth paths (next 30 days)" className="span-all">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#1f2630" />
            <XAxis type="number" dataKey="az" domain={[0, 360]} ticks={[0, 45, 90, 135, 180, 225, 270, 315, 360]} stroke="#8a9099" unit="°" />
            <YAxis type="number" domain={['auto', 'auto']} stroke="#8a9099" unit="°" />
            <Tooltip contentStyle={{ background: '#15191F', border: '1px solid #2a313b' }} />
            <Legend />
            <ReferenceLine y={0} stroke="#444" strokeDasharray="3 3" />
            <Line data={sky.hz} dataKey="horizon" name="Terrain horizon" stroke="#C7CBD1" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Scatter data={sky.sun} dataKey="el" name="Sun (centre)" fill="#E8B85C" isAnimationActive={false} />
            <Scatter data={sky.earth} dataKey="el" name="Earth (centre, region)" fill="#58C7D9" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="Mission-window timeline at inspected point" className="span-all">
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={st.series} margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#1f2630" /><XAxis dataKey="h" stroke="#8a9099" unit=" h" /><YAxis stroke="#8a9099" domain={[0, 1]} />
            <Tooltip contentStyle={{ background: '#15191F', border: '1px solid #2a313b' }} /><Legend />
            <Line type="stepAfter" dataKey="sun" name="Solar disc visible (0–1)" stroke="#E8B85C" dot={false} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="earth" name="Earth LOS (0/1)" stroke="#58C7D9" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <button className="btn" onClick={() => {
          const id = `user-${Date.now()}`; const r = Math.floor(cell / ds.W), c = cell % ds.W;
          m.setSites([...m.sites, { id, name: `User site ${m.sites.filter(x => x.id.startsWith('user')).length + 1}`, cell: [r, c], origin: 'picked in Explorer' }]); m.setSiteId(id);
        }}>＋ Add inspected point as candidate landing site</button>
      </Panel>
    </div>
  );
}
