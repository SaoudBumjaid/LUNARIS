import { useEffect, useMemo, useState } from 'react';
import { useMission } from '../state';
import { Badge, DateInput, Panel, Slider, Stat } from '../components/ui';
import { cellLatLon, fmtDate, fmtLatLon, hourToDate, idx } from '../engine/dataset';
import { horizonAt, sunElGeom, earthElGeom } from '../engine/illum';
import { analyseSpan, loadDsn, pointState, type Dsn, type Win } from '../engine/sky';

const fmtH = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h} h`);
const dir = (az: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((az % 360) + 360) % 360 / 45) % 8];

export function SunEarth() {
  const m = useMission(); const ds = m.ds;
  const [dsn, setDsn] = useState<Dsn | null>(null);
  useEffect(() => { loadDsn().then(setDsn); }, []);
  const cell = m.selected ?? m.siteCell;
  const [la, lo] = cellLatLon(ds, cell);
  const dur = m.durDays * 24;
  const st = pointState(ds, cell, m.hour, dsn);
  const span = useMemo(() => analyseSpan(ds, cell, m.startH, dur, dsn, m.rover.panelW), [ds, cell, m.startH, dur, dsn, m.rover.panelW]);
  const sunState = st.sunFrac >= 0.999 ? ['SUNLIT', 'ok'] : st.sunFrac > 0 ? [`PARTIAL · ${(st.sunFrac * 100).toFixed(0)}% of disc`, 'warn'] : ['IN SHADOW', 'bad'];
  const contact = !st.earthLos ? ['NO LINE OF SIGHT', 'bad', 'Earth is behind the terrain (or below the horizon).']
    : st.dsn === null ? ['LINE OF SIGHT', 'info', 'Earth is above the terrain horizon. DSN table not loaded.']
      : st.dsn.length ? ['CONTACT POSSIBLE (geometry)', 'ok', `Earth is in view and ${st.dsn.length} DSN complex${st.dsn.length > 1 ? 'es see' : ' sees'} the Moon ≥ ${dsn?.minElDeg ?? 10}°.`]
        : ['LOS, NO DSN COMPLEX', 'warn', 'Earth is in view, but no DSN complex has the Moon high enough right now.'];
  const step = (d: number) => m.setHour(Math.max(0, Math.min(ds.hours - 1, m.hour + d)));
  const siteOpts = m.sites.map(s => ({ id: s.id, name: s.name, cell: idx(ds, s.cell[0], s.cell[1]) }));

  return (
    <div className="grid-sky">
      <Panel title="Point & time" className="sky-ctrl">
        <label className="selbox"><span>Landing site</span>
          <select value={m.selected === null ? m.siteId : ''} onChange={e => { m.setSelected(null); m.setSiteId(e.target.value); }}>
            {m.selected !== null && <option value="">Inspected point</option>}
            {siteOpts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <div className="kv"><span>Location</span><b className="mono">{fmtLatLon(la, lo)}</b></div>
        <div className="kv"><span>Elevation · slope</span><b className="mono">{ds.elev[cell].toFixed(0)} m · {ds.slope[cell].toFixed(1)}°</b></div>
        <div className="kv"><span>Observer height</span><b className="mono">{ds.meta.observerHeightM ?? 2} m above ground</b></div>
        <DateInput label="Time shown" hour={m.hour} onChange={m.setHour} />
        <div className="seg stepper" role="group" aria-label="Step time">
          <button onClick={() => step(-24)}>−1 d</button><button onClick={() => step(-1)}>−1 h</button>
          <button onClick={() => m.setHour(m.startH)}>Landing</button>
          <button onClick={() => step(1)}>+1 h</button><button onClick={() => step(24)}>+1 d</button>
        </div>
        <DateInput label="Analysis window starts (landing)" hour={m.startH} onChange={h => { m.setStartH(h); m.setHour(h); }} />
        <Slider label="Window length" value={m.durDays} min={1} max={60} onChange={m.setDurDays} unit=" d" />
      </Panel>

      <div className="sky-cards">
        <div className={`skycard sun ${sunState[1]}`}>
          <div className="skycard-h"><span className="dot sun" />SUN<Badge tone={sunState[1] as 'ok'}>{sunState[0]}</Badge></div>
          <div className="azel"><div><small>Azimuth</small><b>{st.sunAz.toFixed(1)}°</b><i>{dir(st.sunAz)}</i></div><div><small>Elevation</small><b>{st.sunEl.toFixed(2)}°</b></div><div><small>Terrain at that azimuth</small><b>{st.sunHz.toFixed(2)}°</b></div></div>
          <p>Sun centre is {(st.sunEl - st.sunHz).toFixed(2)}° {st.sunEl >= st.sunHz ? 'above' : 'below'} the local skyline. Solar disc radius 0.27°.</p>
        </div>
        <div className={`skycard earth ${st.earthLos ? 'ok' : 'bad'}`}>
          <div className="skycard-h"><span className="dot earth" />EARTH<Badge tone={st.earthLos ? 'ok' : 'bad'}>{st.earthLos ? 'IN VIEW' : 'HIDDEN'}</Badge></div>
          <div className="azel"><div><small>Azimuth</small><b>{st.earthAz.toFixed(1)}°</b><i>{dir(st.earthAz)}</i></div><div><small>Elevation</small><b>{st.earthEl.toFixed(2)}°</b></div><div><small>Terrain at that azimuth</small><b>{st.earthHz.toFixed(2)}°</b></div></div>
          <p>Earth centre is {(st.earthEl - st.earthHz).toFixed(2)}° {st.earthEl >= st.earthHz ? 'above' : 'below'} the local skyline.</p>
        </div>
        <div className={`skycard comm ${contact[1]}`}>
          <div className="skycard-h"><span className="dot comm" />DIRECT-TO-EARTH<Badge tone={contact[1] as 'ok'}>{contact[0]}</Badge></div>
          <p>{contact[2]}</p>
          {dsn && <div className="dsnrow">{dsn.stations.map(s => { const up = st.dsn?.includes(s.name); return <span key={s.name} className={up ? 'up' : ''}>{s.name.split(' (')[0]} <b>{up ? '▲' : '▽'}</b></span>; })}</div>}
          <p className="note">Three levels: <b>line of sight</b> (terrain, computed) → <b>a DSN complex sees the Moon</b> (computed) → <b>real link</b> (needs a scheduled antenna — not modelled).</p>
        </div>
      </div>

      <Panel title={<>Skyline panorama <span className="muted">· terrain horizon with Sun and Earth paths for the analysis window</span></>} className="span-all">
        <Panorama ds={ds} cell={cell} h0={m.startH} dur={dur} hour={m.hour} />
      </Panel>

      <Panel title={<>Analysis window <span className="muted">· {fmtDate(hourToDate(ds, m.startH))} + {m.durDays} d · click a strip to jump in time</span></>} className="span-all">
        <div className="stats6">
          <Stat label="Sunlit (>½ disc)" value={span.litPct.toFixed(0)} unit="%" tone="info" />
          <Stat label="Solar energy" value={span.kWhPerDay.toFixed(1)} unit=" kWh/day" tone="info" />
          <Stat label="Longest darkness" value={fmtH(span.longestDarkH)} tone={span.longestDarkH > m.lander.batteryNightH ? 'bad' : 'ok'} />
          <Stat label="Earth line of sight" value={span.losPct.toFixed(0)} unit="%" tone="info" />
          <Stat label="Contact possible" value={span.contactPct.toFixed(0)} unit="%" tone="info" />
          <Stat label="Longest no-contact" value={fmtH(span.longestNoContactH)} tone={span.longestNoContactH > 72 ? 'warn' : 'ok'} />
        </div>
        <Strips span={span} hour={m.hour} onPick={m.setHour} />
        <p className="note">Energy assumes an ideal {span.panelW} W Sun-tracking panel (rover setting) × visible fraction of the solar disc, no thermal, dust or conversion losses. “Contact possible” = Earth line of sight AND at least one DSN complex sees the Moon ≥ {dsn?.minElDeg ?? 10}°; antenna scheduling is not modelled.</p>
      </Panel>

      <Panel title="Sunlight windows" right={<span className="muted small">{span.sunWins.length} in window</span>}>
        <WinTable wins={span.sunWins} ds={ds} onPick={m.setHour} />
      </Panel>
      <Panel title="Communication windows (geometric contact)" right={<span className="muted small">{span.contactWins.length} in window</span>}>
        <WinTable wins={span.contactWins} ds={ds} onPick={m.setHour} />
      </Panel>
    </div>
  );
}

function WinTable({ wins, ds, onPick }: { wins: Win[]; ds: ReturnType<typeof useMission>['ds']; onPick: (h: number) => void }) {
  if (!wins.length) return <p className="note">None in this window.</p>;
  const shown = wins.slice(0, 40);
  return (
    <div className="tblwrap"><table className="tbl">
      <thead><tr><th>Start (UTC)</th><th>End (UTC)</th><th>Duration</th></tr></thead>
      <tbody>{shown.map(w => <tr key={w.start} onClick={() => onPick(w.start)}><td className="mono">{fmtDate(hourToDate(ds, w.start)).slice(0, 16)}</td><td className="mono">{fmtDate(hourToDate(ds, w.end)).slice(0, 16)}</td><td className="mono">{fmtH(w.hours)}</td></tr>)}</tbody>
    </table>{wins.length > shown.length && <p className="note">+ {wins.length - shown.length} more</p>}</div>
  );
}

function Strips({ span, hour, onPick }: { span: ReturnType<typeof analyseSpan>; hour: number; onPick: (h: number) => void }) {
  const W = 1000, rows: [string, Uint8Array | Float32Array, string][] = [['Sunlight', span.sunFrac, '#E8B85C'], ['Earth line of sight', span.los, '#58C7D9'], ['Contact possible', span.contact, '#5fd38a']];
  const n = span.dur, cur = (hour - span.h0) / n;
  return (
    <svg viewBox={`0 0 ${W} ${rows.length * 30}`} className="strips" role="img" aria-label="Hour-by-hour sunlight, Earth line of sight and contact"
      onClick={e => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const f = (e.clientX - r.left) / r.width; const lab = 150 / W; if (f > lab) onPick(Math.round(span.h0 + (f - lab) / (1 - lab) * n)); }}>
      {rows.map(([lab, arr, col], k) => {
        const x0 = 150, w = (W - x0) / n; const parts: React.ReactElement[] = []; let s = -1;
        for (let i = 0; i <= n; i++) { const on = i < n && arr[i] > 0.5; if (on && s < 0) s = i; if (!on && s >= 0) { parts.push(<rect key={i} x={x0 + s * w} y={k * 30 + 6} width={(i - s) * w} height={18} fill={col} />); s = -1; } }
        return <g key={lab}><text x={0} y={k * 30 + 20} className="svglab">{lab}</text><rect x={x0} y={k * 30 + 6} width={W - x0} height={18} fill="#141b26" />{parts}</g>;
      })}
      {cur >= 0 && cur <= 1 && <line x1={150 + cur * (W - 150)} x2={150 + cur * (W - 150)} y1={0} y2={rows.length * 30} stroke="#fff" strokeWidth={1.5} />}
    </svg>
  );
}

function Panorama({ ds, cell, h0, dur, hour }: { ds: ReturnType<typeof useMission>['ds']; cell: number; h0: number; dur: number; hour: number }) {
  const data = useMemo(() => {
    const hz: [number, number][] = []; for (let a = 0; a <= 360; a += 1) hz.push([a, horizonAt(ds, cell, a)]);
    const sun: [number, number][] = [], earth: [number, number][] = [];
    for (let h = h0; h < Math.min(ds.hours, h0 + dur); h += 2) { sun.push([ds.ephem.sunAz[h], sunElGeom(ds, cell, h)]); earth.push([ds.ephem.earthAz[h], earthElGeom(ds, cell, h)]); }
    const all = [...hz.map(p => p[1]), ...sun.map(p => p[1]), ...earth.map(p => p[1])];
    const lo = Math.max(-8, Math.floor(Math.min(...all) - 0.5)), hi = Math.min(16, Math.ceil(Math.max(...all) + 1));
    return { hz, sun, earth, lo, hi };
  }, [ds, cell, h0, dur]);
  const W = 1000, H = 260, L = 40, B = 22;
  const X = (az: number) => L + (((az % 360) + 360) % 360) / 360 * (W - L - 8), Y = (el: number) => 8 + (data.hi - el) / (data.hi - data.lo) * (H - 8 - B);
  const pxPerDeg = (H - 8 - B) / (data.hi - data.lo);
  const t = Math.max(0, Math.min(ds.hours - 1, hour));
  const sAz = ds.ephem.sunAz[t], sEl = sunElGeom(ds, cell, t), eAz = ds.ephem.earthAz[t], eEl = earthElGeom(ds, cell, t);
  const poly = `${X(0)},${H - B} ` + data.hz.map(([a, e]) => `${L + a / 360 * (W - L - 8)},${Y(e)}`).join(' ') + ` ${L + (W - L - 8)},${H - B}`;
  const path = (pts: [number, number][]) => { let d = ''; let prev = -1; for (const [a, e] of pts) { const x = X(a); d += (prev < 0 || Math.abs(x - prev) > 200 ? 'M' : 'L') + x.toFixed(1) + ',' + Y(e).toFixed(1); prev = x; } return d; };
  const ticks: number[] = []; for (let e = Math.ceil(data.lo); e <= data.hi; e += (data.hi - data.lo > 10 ? 2 : 1)) ticks.push(e);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="panorama" role="img" aria-label="Terrain skyline with Sun and Earth paths">
      <defs><linearGradient id="skyg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0b1a33" /><stop offset="1" stopColor="#050a14" /></linearGradient></defs>
      <rect x={L} y={8} width={W - L - 8} height={H - 8 - B} fill="url(#skyg)" />
      {ticks.map(e => <g key={e}><line x1={L} x2={W - 8} y1={Y(e)} y2={Y(e)} stroke={e === 0 ? '#3d5476' : '#16243a'} strokeDasharray={e === 0 ? '4 3' : undefined} /><text x={L - 6} y={Y(e) + 3} className="svgtick" textAnchor="end">{e}°</text></g>)}
      {[0, 45, 90, 135, 180, 225, 270, 315, 360].map(a => <text key={a} x={X(a === 360 ? 359.99 : a)} y={H - 6} className="svgtick" textAnchor="middle">{a}° {dir(a)}</text>)}
      <path d={path(data.sun)} stroke="#E8B85C" strokeOpacity={0.75} fill="none" strokeWidth={1.4} />
      <path d={path(data.earth)} stroke="#58C7D9" strokeOpacity={0.75} fill="none" strokeWidth={1.4} />
      <circle cx={X(sAz)} cy={Y(sEl)} r={Math.max(3, 0.267 * pxPerDeg)} fill="#FFD27A" stroke="#fff" strokeWidth={0.8} />
      <circle cx={X(eAz)} cy={Y(eEl)} r={Math.max(4, 0.95 * pxPerDeg)} fill="#2E8FD6" stroke="#bfe9f5" strokeWidth={0.8} />
      <polygon points={poly} fill="#1c222c" stroke="#C7CBD1" strokeWidth={1.2} />
      {/* outlines stay visible when the body is hidden behind terrain */}
      <circle cx={X(sAz)} cy={Y(sEl)} r={Math.max(3, 0.267 * pxPerDeg) + 3} fill="none" stroke="#FFD27A" strokeDasharray="2 2" />
      <circle cx={X(eAz)} cy={Y(eEl)} r={Math.max(4, 0.95 * pxPerDeg) + 3} fill="none" stroke="#58C7D9" strokeDasharray="2 2" />
      <text x={L + 6} y={22} className="svglab">Terrain skyline (LOLA) · <tspan fill="#E8B85C">Sun path</tspan> · <tspan fill="#58C7D9">Earth path</tspan> · discs = position at the time shown (true angular size)</text>
    </svg>
  );
}
