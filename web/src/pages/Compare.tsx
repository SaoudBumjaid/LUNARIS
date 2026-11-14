import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMission } from '../state';
import { useWorkspace, sameItem, type ShortItem } from '../workspace';
import { Panel, Slider, download } from '../components/ui';
import { dateToHour, fmtDate, fmtLatLon, hourToDate, type Dataset } from '../engine/dataset';
import { horizonAt, earthElGeom } from '../engine/illum';
import { GOALS, analyseSpan, getDataset, loadDsn, scoreSpan, siteCellIndex, toCsv, type Dsn, type Goal, type SiteRef, type SpanResult } from '../engine/sky';

const COLORS = ['#F2B544', '#35C8E6', '#B58CFF', '#5FD38A'];
const fmtH = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h} h`);
interface Col { key: string; label: string; sub: string; site: SiteRef; ds: Dataset; h0: number; r: SpanResult }

export function Compare() {
  const m = useMission(); const ws = useWorkspace();
  const [mode, setMode] = useState<'sites' | 'dates'>('sites');
  const [startH, setStartH] = useState(m.startH);
  const [days, setDays] = useState(30);
  const [goal, setGoal] = useState<Goal>('balanced');
  const [pw, setPw] = useState(0.5);
  const [dateSite, setDateSite] = useState<ShortItem | null>(null);
  const [dates, setDates] = useState<number[]>(() => [m.startH, m.startH + 30 * 24 * 1, m.startH + 30 * 24 * 3].map(h => Math.min(h, m.ds.hours - 24)));
  const [dsMap, setDsMap] = useState<Record<string, Dataset>>({});
  const [dsn, setDsn] = useState<Dsn | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState('');
  useEffect(() => { loadDsn().then(setDsn); }, []);
  const ds0 = m.ds; const maxH = ds0.hours;

  const findSite = (it: ShortItem) => ws.sites.find(s => sameItem(s, it));
  const picks: ShortItem[] = mode === 'sites' ? ws.shortlist : (dateSite ? [dateSite] : ws.shortlist.slice(0, 1));
  const need = [...new Set(picks.map(p => p.regionId))];
  useEffect(() => {
    let alive = true;
    Promise.all(need.map(id => getDataset(id).then(d => [id, d] as const))).then(list => { if (alive) setDsMap(o => { const n = { ...o }; for (const [k, v] of list) n[k] = v; return n; }); }).catch(e => setErr(String(e.message ?? e)));
    return () => { alive = false; };
  }, [need.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const dur = days * 24;
  const cols: Col[] = useMemo(() => {
    const out: Col[] = [];
    if (mode === 'sites') {
      for (const it of ws.shortlist) { const s = findSite(it), d = dsMap[it.regionId]; if (!s || !d) continue;
        out.push({ key: `${it.regionId}/${it.siteId}`, label: s.name, sub: s.regionName, site: s, ds: d, h0: startH, r: analyseSpan(d, siteCellIndex(d, s), startH, dur, dsn, m.rover.panelW) }); }
    } else {
      const it = picks[0]; const s = it && findSite(it), d = it && dsMap[it.regionId];
      if (s && d) dates.forEach((h, k) => out.push({ key: `d${k}`, label: fmtDate(hourToDate(d, h)).slice(0, 10), sub: s.name, site: s, ds: d, h0: h, r: analyseSpan(d, siteCellIndex(d, s), h, dur, dsn, m.rover.panelW) }));
    }
    return out;
  }, [mode, ws.shortlist, dsMap, startH, dur, dsn, dates, picks[0]?.siteId, picks[0]?.regionId, m.rover.panelW]); // eslint-disable-line react-hooks/exhaustive-deps

  const scored = cols.map(c => ({ c, s: scoreSpan(c.r, pw) })).sort((a, b) => b.s.total - a.s.total);
  const win = scored[0], second = scored[1];

  // synchronized series: every 3 h, per column (x = hours from each column's own start)
  const series = useMemo(() => {
    const n = Math.min(...cols.map(c => c.r.dur), dur); const rows: Record<string, number | string>[] = [];
    const cum = cols.map(() => 0);
    for (let k = 0; k < n; k += 3) {
      const row: Record<string, number | string> = { k, day: +(k / 24).toFixed(2) };
      cols.forEach((c, j) => {
        let s = 0; for (let q = k; q < Math.min(n, k + 3); q++) s += c.r.sunFrac[q]; cum[j] += c.r.panelW * s / 1000;
        row[`sun${j}`] = +(c.r.sunFrac[k] * 100).toFixed(0);
        const cell = siteCellIndex(c.ds, c.site), h = c.h0 + k, az = c.ds.ephem.earthAz[Math.min(c.ds.hours - 1, h)];
        row[`earth${j}`] = +(earthElGeom(c.ds, cell, h) - horizonAt(c.ds, cell, az)).toFixed(2);
        row[`kwh${j}`] = +cum[j].toFixed(1);
      });
      rows.push(row);
    }
    return rows;
  }, [cols, dur]);

  const metrics: { k: string; label: string; v: (r: SpanResult) => number; fmt: (x: number) => string; bar?: boolean; better: 'hi' | 'lo'; color?: string }[] = [
    { k: 'lit', label: 'Sunlit (>½ disc)', v: r => r.litPct, fmt: x => `${x.toFixed(0)}%`, bar: true, better: 'hi', color: '#E8B85C' },
    { k: 'los', label: 'Earth line of sight', v: r => r.losPct, fmt: x => `${x.toFixed(0)}%`, bar: true, better: 'hi', color: '#58C7D9' },
    { k: 'con', label: 'Contact possible (LOS + DSN)', v: r => r.contactPct, fmt: x => `${x.toFixed(0)}%`, bar: true, better: 'hi', color: '#2E8FD6' },
    { k: 'both', label: 'Sunlit + contact', v: r => r.bothPct, fmt: x => `${x.toFixed(0)}%`, bar: true, better: 'hi', color: '#5FD38A' },
    { k: 'kwh', label: 'Solar energy', v: r => r.kWhPerDay, fmt: x => `${x.toFixed(2)} kWh/d`, better: 'hi' },
    { k: 'dark', label: 'Longest darkness', v: r => r.longestDarkH, fmt: fmtH, better: 'lo' },
    { k: 'gap', label: 'Longest no-contact', v: r => r.longestNoContactH, fmt: fmtH, better: 'lo' },
  ];
  const best = (mk: typeof metrics[number]) => { const vs = cols.map(c => mk.v(c.r)); return mk.better === 'hi' ? Math.max(...vs) : Math.min(...vs); };

  const exportCsv = () => {
    const head = ['label', 'site', 'region', 'lat', 'lon', 'window_start_utc', 'days', ...metrics.map(x => x.k), 'power_score', 'contact_score', 'total_score'];
    const rows = scored.map(({ c, s }) => [c.label, c.site.name, c.site.regionName, +c.site.lat.toFixed(5), +c.site.lon.toFixed(5), fmtDate(hourToDate(c.ds, c.h0)), days,
      ...metrics.map(x => +x.v(c.r).toFixed(2)), +s.power.toFixed(1), +s.contact.toFixed(1), +s.total.toFixed(1)]);
    download(`lunaris_compare_${mode}.csv`, toCsv(head, rows, [
      'LUNARIS comparison export. Terrain: NASA LRO LOLA (20 m local + 400 m far field). Sun/Earth: JPL DE421 + IAU lunar rotation (checked vs JPL Horizons, max 0.003 deg).',
      `Observer 2 m above ground. lit = >50% of solar disc above terrain. contact = Earth line of sight AND a DSN complex sees the Moon >= ${dsn?.minElDeg ?? 10} deg (geometry only, no antenna schedule).`,
      `Scores: power = 0.6*mean sun% + 0.4*night score; contact = 0.6*contact% + 0.4*gap score; scores fall linearly from 100 (0 h) to 0 (7 d). total = ${pw.toFixed(2)}*power + ${(1 - pw).toFixed(2)}*contact.`,
    ]), 'text/csv');
  };

  const addable = ws.sites.filter(s => !ws.shortlist.some(x => sameItem(x, s)));
  const loading = picks.some(p => !dsMap[p.regionId]);

  return (
    <div className="grid-compare">
      <Panel title="What to compare" className="cmp-ctrl">
        <div className="seg full" role="tablist">
          <button role="tab" aria-selected={mode === 'sites'} className={mode === 'sites' ? 'on' : ''} onClick={() => setMode('sites')}>Sites</button>
          <button role="tab" aria-selected={mode === 'dates'} className={mode === 'dates' ? 'on' : ''} onClick={() => setMode('dates')}>Dates</button>
        </div>
        {mode === 'sites' ? <>
          <h4>Shortlist <span className="muted small">({ws.shortlist.length} of 4)</span></h4>
          {ws.shortlist.map((it, j) => { const s = findSite(it); return s && (
            <div key={it.regionId + it.siteId} className="pickrow"><span className="sw" style={{ background: COLORS[j] }} />
              <div className="grow"><b>{s.name}</b><div className="small muted">{s.regionName}</div></div>
              <button className="x" aria-label={`Remove ${s.name}`} onClick={() => ws.setShortlist(ws.shortlist.filter(x => !sameItem(x, it)))}>✕</button></div>); })}
          {ws.shortlist.length < 4 && <div className="row">
            <select className="sel grow" value={adding} onChange={e => setAdding(e.target.value)} aria-label="Site to add">
              <option value="">Add a site…</option>
              {ws.regions.map(r => <optgroup key={r.id} label={r.name}>{addable.filter(s => s.regionId === r.id).map(s => <option key={s.siteId} value={`${s.regionId}|${s.siteId}`}>{s.name}</option>)}</optgroup>)}
            </select>
            <button className="btn" disabled={!adding} onClick={() => { const [regionId, siteId] = adding.split('|'); ws.setShortlist([...ws.shortlist, { regionId, siteId }]); setAdding(''); }}>Add</button>
          </div>}
          <label className="dateinput"><span>Window starts (UTC)</span>
            <input type="datetime-local" value={hourToDate(ds0, startH).toISOString().slice(0, 16)} onChange={e => e.target.value && setStartH(dateToHour(ds0, new Date(e.target.value + 'Z')))} /></label>
        </> : <>
          <label className="selbox"><span>Site</span>
            <select value={picks[0] ? `${picks[0].regionId}|${picks[0].siteId}` : ''} onChange={e => { const [regionId, siteId] = e.target.value.split('|'); setDateSite({ regionId, siteId }); }}>
              {ws.regions.map(r => <optgroup key={r.id} label={r.name}>{ws.sites.filter(s => s.regionId === r.id).map(s => <option key={s.siteId} value={`${s.regionId}|${s.siteId}`}>{s.name}</option>)}</optgroup>)}
            </select></label>
          {dates.map((h, j) => <div key={j} className="pickrow"><span className="sw" style={{ background: COLORS[j] }} />
            <input className="grow dt" type="datetime-local" aria-label={`Start date ${j + 1}`} value={hourToDate(ds0, h).toISOString().slice(0, 16)} onChange={e => e.target.value && setDates(dates.map((x, q) => q === j ? Math.min(dateToHour(ds0, new Date(e.target.value + 'Z')), maxH - 24) : x))} />
            {dates.length > 2 && <button className="x" aria-label="Remove date" onClick={() => setDates(dates.filter((_, q) => q !== j))}>✕</button>}</div>)}
          {dates.length < 4 && <button className="btn" onClick={() => setDates([...dates, Math.min(maxH - 24, dates[dates.length - 1] + 30 * 24)])}>+ Add date</button>}
        </>}
        <Slider label="Window length" value={days} min={1} max={90} onChange={setDays} unit=" d" />
        <h4>What matters most?</h4>
        <div className="chips">{GOALS.map(g => <button key={g.key} className={`chip ${goal === g.key ? 'on' : ''}`} aria-pressed={goal === g.key} onClick={() => { setGoal(g.key); setPw(g.power); }}>{g.label}</button>)}</div>
        <Slider label="Weight on power (rest on Earth contact)" value={Math.round(pw * 100)} min={0} max={100} step={5} onChange={v => { setPw(v / 100); setGoal(GOALS.find(g => Math.round(g.power * 100) === v)?.key ?? goal); }} unit="%" />
        <button className="btn wide" disabled={!cols.length} onClick={exportCsv}>⤓ Export CSV (with provenance)</button>
      </Panel>

      <div className="cmp-main">
        {err && <p className="note warn">{err}</p>}
        {(mode === 'sites' && ws.shortlist.length < 2) ? <Panel title="Pick at least two sites"><p className="note">Add sites here, or use “+ Compare” on the South Pole Map.</p></Panel>
          : loading ? <Panel title="Loading"><div className="empty"><div className="spinner" />Loading regional terrain data…</div></Panel>
            : win && <>
              <Panel title={<>Best for your priorities: <span className="gold">{win.c.label}</span> {mode === 'dates' && <span className="muted">at {win.c.sub}</span>} · {win.s.total.toFixed(0)} / 100</>} className="winner">
                <p>{win.c.label} comes first {second ? <>— {(win.s.total - second.s.total) < 2 ? 'almost tied with' : 'ahead of'} {second.c.label} ({second.s.total.toFixed(0)}). </> : '. '}
                  Power score {win.s.power.toFixed(0)}{second && ` vs ${second.s.power.toFixed(0)}`}; Earth-contact score {win.s.contact.toFixed(0)}{second && ` vs ${second.s.contact.toFixed(0)}`}.</p>
                <div className="worked mono">
                  <div>Total {win.s.total.toFixed(1)} = {pw.toFixed(2)} × Power {win.s.power.toFixed(1)} + {(1 - pw).toFixed(2)} × Contact {win.s.contact.toFixed(1)}</div>
                  <small>Power = 0.6 × mean sunlight {win.c.r.meanSunPct.toFixed(1)}% + 0.4 × night score {win.s.nightScore.toFixed(0)} (longest dark {fmtH(win.c.r.longestDarkH)}) · Contact = 0.6 × contact {win.c.r.contactPct.toFixed(1)}% + 0.4 × gap score {win.s.gapScoreV.toFixed(0)} (longest no-contact {fmtH(win.c.r.longestNoContactH)}). Night and gap scores fall from 100 at 0 h to 0 at 7 days.</small>
                </div>
                <div className="row0"><button className="btn primary" onClick={() => ws.openSite(win.c.site.regionId, win.c.site.siteId, 'sky')}>Open in Sun & Earth →</button>
                  <button className="btn" onClick={() => ws.openSite(win.c.site.regionId, win.c.site.siteId, 'landing')}>Check landing safety</button></div>
              </Panel>
              <Panel title="Side by side" right={<span className="muted small">{days}-day window{mode === 'sites' ? ` from ${fmtDate(hourToDate(ds0, startH))}` : ''}</span>}>
                <div className="sbs">
                  {scored.map(({ c, s }) => { const j = cols.indexOf(c); return (
                    <div key={c.key} className="sbs-col">
                      <div className="sbs-h"><span className="sw" style={{ background: COLORS[j] }} /><div><b>{c.label}</b><div className="small muted">{c.sub} · {fmtLatLon(c.site.lat, c.site.lon)}</div></div><span className="score mono">{s.total.toFixed(0)}</span></div>
                      {metrics.filter(x => x.bar).map(x => <div key={x.k} className="hbar"><span>{x.label}</span><div><i style={{ width: `${x.v(c.r)}%`, background: x.color }} /></div><b className="mono">{x.fmt(x.v(c.r))}</b></div>)}
                      <div className="kv"><span>Solar energy</span><b className="mono">{c.r.kWhPerDay.toFixed(2)} kWh/day</b></div>
                      <div className="kv"><span>Longest darkness</span><b className="mono">{fmtH(c.r.longestDarkH)}</b></div>
                      <div className="kv"><span>Longest no-contact</span><b className="mono">{fmtH(c.r.longestNoContactH)}</b></div>
                    </div>); })}
                </div>
              </Panel>
              <Panel title="Exact numbers">
                <div className="tblwrap"><table className="tbl num">
                  <thead><tr><th>Metric</th>{cols.map((c, j) => <th key={c.key}><span className="sw" style={{ background: COLORS[j] }} /> {c.label}</th>)}</tr></thead>
                  <tbody>{metrics.map(x => { const b = best(x); return <tr key={x.k}><td>{x.label}</td>{cols.map(c => <td key={c.key} className={`mono ${x.v(c.r) === b && cols.length > 1 ? 'best' : ''}`}>{x.fmt(x.v(c.r))}</td>)}</tr>; })}
                    <tr><td>Score (your weights)</td>{cols.map(c => <td key={c.key} className="mono">{scoreSpan(c.r, pw).total.toFixed(1)}</td>)}</tr></tbody>
                </table></div>
                <p className="note">Best value in each row is highlighted. All values are calculated by LUNARIS from LOLA terrain and the JPL DE421 ephemeris (2 m mast); they are estimates, not measurements. “Contact possible” is geometric only.</p>
              </Panel>
              <Panel title={<>Synchronized timelines <span className="muted">· hover any chart — all three follow · x = days from each window's start</span></>}>
                <SyncChart rows={series} cols={cols} pre="sun" unit="%" title="Visible solar disc (%)" domain={[0, 100]} step />
                <SyncChart rows={series} cols={cols} pre="earth" unit="°" title="Earth centre above the terrain skyline (°) — above 0 = line of sight" ref0 />
                <SyncChart rows={series} cols={cols} pre="kwh" unit=" kWh" title={`Cumulative solar energy, ${m.rover.panelW} W ideal panel (kWh)`} />
              </Panel>
            </>}
      </div>
    </div>
  );
}

function SyncChart({ rows, cols, pre, unit, title, domain, step, ref0 }: { rows: Record<string, number | string>[]; cols: Col[]; pre: string; unit: string; title: string; domain?: [number, number]; step?: boolean; ref0?: boolean }) {
  return (
    <div className="syncchart">
      <div className="small muted">{title}</div>
      <ResponsiveContainer width="100%" height={170}>
        <LineChart data={rows} syncId="lunaris-compare" margin={{ top: 6, right: 16, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="#16243a" vertical={false} />
          <XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']} stroke="#6d7d93" tickFormatter={d => `d${Math.round(d)}`} fontSize={11} />
          <YAxis stroke="#6d7d93" domain={domain ?? ['auto', 'auto']} fontSize={11} unit={unit === '%' ? '%' : unit === '°' ? '°' : ''} />
          <Tooltip contentStyle={{ background: '#0b1424', border: '1px solid #263852', fontSize: 12 }} labelFormatter={d => `day ${Number(d).toFixed(1)}`} formatter={(v, n) => [`${v}${unit}`, String(n)]} />
          {ref0 && <Line dataKey={() => 0} stroke="#3d5476" strokeDasharray="4 3" dot={false} legendType="none" isAnimationActive={false} name="skyline" />}
          {cols.map((c, j) => <Line key={c.key} type={step ? 'stepAfter' : 'monotone'} dataKey={`${pre}${j}`} name={c.label} stroke={COLORS[j]} dot={false} strokeWidth={1.6} isAnimationActive={false} />)}
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

