import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { useWorkspace, sameItem } from '../workspace';
import { Badge, Panel, Stat } from '../components/ui';
import { fmtLatLon } from '../engine/dataset';
import { getDataset, type SiteRef } from '../engine/sky';
import { layerColors } from '../engine/layers';

interface PoleMeta { size: number; pxM: number; xLeftM: number; yTopM: number; R: number; source: string; projection: string; elevMinM: number; elevMaxM: number }
const D = Math.PI / 180;

// Polar stereographic (same convention as pipeline/build_open.py: unit_to_stereo)
function llToXY(lat: number, lon: number, R: number): [number, number] {
  const la = lat * D, lo = lon * D, z = Math.sin(la), k = 2 * R / (1 - z);
  return [k * Math.cos(la) * Math.sin(lo), k * Math.cos(la) * Math.cos(lo)];
}
function xyToLL(x: number, y: number, R: number): [number, number] {
  const s = (Math.hypot(x, y) / (2 * R)) ** 2, z = (s - 1) / (s + 1);
  return [Math.asin(z) / D, Math.atan2(x, y) / D];
}
const REGION_KM = 8;

export function PoleMap() {
  const ws = useWorkspace();
  const [pm, setPm] = useState<PoleMeta | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 });       // canvas px = img px * s + t
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [sel, setSel] = useState<string>(ws.regionId);
  const [showGrid, setShowGrid] = useState(true);
  const [detail, setDetail] = useState<'relief' | 'sun' | 'off'>('relief');
  const [tiles, setTiles] = useState<Record<string, HTMLCanvasElement>>({});
  const inflight = useRef(new Set<string>());
  const cv = useRef<HTMLCanvasElement>(null); const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(800); const H = Math.min(720, Math.max(380, Math.round(W * 0.78)));

  useEffect(() => {
    fetch('./data/polemap/polemap.json').then(r => { if (!r.ok) throw new Error('polemap.json missing — run pipeline/build_extras.py'); return r.json(); }).then(setPm).catch(e => setErr(String(e.message ?? e)));
    const im = new Image(); im.onload = () => setImg(im); im.onerror = () => setErr('Could not load the south-pole map image.'); im.src = './data/polemap/pole_hillshade.jpg';
  }, []);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(e => setW(Math.max(300, Math.floor(e[0].contentRect.width)))); ro.observe(el); return () => ro.disconnect();
  }, []);
  const fit = () => { if (!pm) return; const s = Math.min(W, H) / pm.size * 1.0; setView({ s, tx: (W - pm.size * s) / 2, ty: (H - pm.size * s) / 2 }); };
  useEffect(fit, [pm, W, H]); // eslint-disable-line react-hooks/exhaustive-deps

  const toImg = (lat: number, lon: number): [number, number] | null => {
    if (!pm) return null; const [x, y] = llToXY(lat, lon, pm.R); return [(x - pm.xLeftM) / pm.pxM, (pm.yTopM - y) / pm.pxM];
  };
  const toCanvas = (lat: number, lon: number) => { const p = toImg(lat, lon); return p ? [p[0] * view.s + view.tx, p[1] * view.s + view.ty] as [number, number] : null; };
  const fromCanvas = (cx: number, cy: number): [number, number] | null => {
    if (!pm) return null; const ix = (cx - view.tx) / view.s, iy = (cy - view.ty) / view.s;
    return xyToLL(pm.xLeftM + ix * pm.pxM, pm.yTopM - iy * pm.pxM, pm.R);
  };

  // 40 m LUNARIS terrain tiles, drawn over the 400 m map once zoomed in
  const wantTiles = view.s > 2.5 && detail !== 'off';
  useEffect(() => {
    if (!wantTiles) return;
    for (const r of ws.regions) {
      const key = r.id + ':' + detail; if (tiles[key] || inflight.current.has(key)) continue;
      const cp = toCanvas(r.lat, r.lon); if (!cp || cp[0] < -200 || cp[1] < -200 || cp[0] > W + 200 || cp[1] > H + 200) continue;   // only regions on screen
      inflight.current.add(key);
      getDataset(r.id).then(ds => {
        const c = document.createElement('canvas'); c.width = ds.W; c.height = ds.H; const g = c.getContext('2d')!; const im = g.createImageData(ds.W, ds.H);
        if (detail === 'sun') { const col = layerColors(ds, 'sunAnnual', 0); for (let i = 0; i < ds.N; i++) { im.data[4 * i] = col[3 * i]; im.data[4 * i + 1] = col[3 * i + 1]; im.data[4 * i + 2] = col[3 * i + 2]; im.data[4 * i + 3] = 255; } }
        else {
          // same shading as the 400 m map (pipeline/build_extras.py), computed in the map's own frame so both match
          const L = ds.meta.center.lon * D, az = 315 * D, alt = 15 * D, e = ds.elev, Wd = ds.W;
          for (let r = 0; r < ds.H; r++) for (let q = 0; q < Wd; q++) {
            const i = r * Wd + q;
            const gE = (e[r * Wd + Math.min(Wd - 1, q + 1)] - e[r * Wd + Math.max(0, q - 1)]) / (2 * ds.cell);
            const gN = (e[Math.max(0, r - 1) * Wd + q] - e[Math.min(ds.H - 1, r + 1) * Wd + q]) / (2 * ds.cell);
            const dx = gE * Math.cos(L) + gN * Math.sin(L), dy = gE * Math.sin(L) - gN * Math.cos(L);
            const sl = Math.atan(Math.hypot(dx, dy)), asp = Math.atan2(-dx, dy);
            const hs = Math.min(1, Math.max(0, Math.sin(alt) * Math.cos(sl) + Math.cos(alt) * Math.sin(sl) * Math.cos(az - asp)));
            const v = 30 + 215 * Math.pow(hs, 0.9); im.data[4 * i] = v * 0.88; im.data[4 * i + 1] = v * 0.93; im.data[4 * i + 2] = v; im.data[4 * i + 3] = 255;
          }
        }
        g.putImageData(im, 0, 0);
        (c as HTMLCanvasElement & { meta?: unknown }).meta = { lat: ds.meta.center.lat, lon: ds.meta.center.lon, cell: ds.cell, W: ds.W, H: ds.H };
        setTiles(t => ({ ...t, [key]: c }));
      }).catch(() => { inflight.current.delete(key); /* tile is optional */ });
    }
  }, [wantTiles, detail, ws.regions, view, W, H]); // eslint-disable-line react-hooks/exhaustive-deps

  const regionSites = useMemo(() => { const g: Record<string, SiteRef[]> = {}; for (const s of ws.sites) (g[s.regionId] ??= []).push(s); return g; }, [ws.sites]);

  // draw
  useEffect(() => {
    const c = cv.current; if (!c || !pm || !img) return;
    const dpr = window.devicePixelRatio || 1; c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#04070d'; g.fillRect(0, 0, W, H);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, view.tx, view.ty, pm.size * view.s, pm.size * view.s);
    const pole = toCanvas(-90, 0)!;
    if (wantTiles) for (const r of ws.regions) {
      const t = tiles[r.id + ':' + detail] as (HTMLCanvasElement & { meta?: { lat: number; lon: number; cell: number; W: number; H: number } }) | undefined;
      const p = toCanvas(r.lat, r.lon); if (!t?.meta || !p) continue;
      // local grid: columns = east, rows = south. In this map, north at longitude L points along (sin L, -cos L).
      const L = t.meta.lon * D, k = t.meta.cell / pm.pxM * view.s;
      g.save(); g.setTransform(dpr * Math.cos(L) * k, dpr * Math.sin(L) * k, dpr * -Math.sin(L) * k, dpr * Math.cos(L) * k, dpr * p[0], dpr * p[1]);
      g.imageSmoothingEnabled = view.s < 30; g.drawImage(t, -t.meta.W / 2, -t.meta.H / 2); g.restore();
    }
    if (showGrid) {
      g.strokeStyle = 'rgba(120,170,220,.28)'; g.lineWidth = 1; g.font = '10px JetBrains Mono, monospace'; g.fillStyle = 'rgba(170,200,230,.75)';
      for (const lat of [-89, -88, -87, -86, -85, -84, -83]) {
        const p = toCanvas(lat, 0)!; const r = Math.hypot(p[0] - pole[0], p[1] - pole[1]);
        g.beginPath(); g.arc(pole[0], pole[1], r, 0, 2 * Math.PI); g.stroke(); g.fillText(`${-lat}°S`, pole[0] + 3, pole[1] - r - 3);
      }
      for (let lon = 0; lon < 360; lon += 30) {
        const a = toCanvas(-82.5, lon)!; g.beginPath(); g.moveTo(pole[0], pole[1]); g.lineTo(a[0], a[1]); g.stroke();
        const t = toCanvas(-83.1, lon)!; g.fillText(lon <= 180 ? `${lon}°E` : `${360 - lon}°W`, t[0] - 12, t[1]);
      }
      g.fillStyle = '#ffb547'; g.beginPath(); g.arc(pole[0], pole[1], 3, 0, 7); g.fill();
      g.fillText('South Pole', pole[0] + 6, pole[1] + 12);
    }
    const placed: [number, number][] = [];
    for (const r of ws.regions) {
      const p = toCanvas(r.lat, r.lon); if (!p) continue;
      const half = REGION_KM * 500 / pm.pxM * view.s, on = r.id === sel, cur = r.id === ws.regionId;
      g.save(); g.translate(p[0], p[1]); g.rotate(r.lon * D);   // the region grid is aligned with local east/north
      g.strokeStyle = on ? '#ffd27a' : '#35c8e6'; g.lineWidth = on ? 2.5 : 1.5;
      g.strokeRect(-Math.max(half, 5), -Math.max(half, 5), 2 * Math.max(half, 5), 2 * Math.max(half, 5));
      g.restore();
      for (const s of regionSites[r.id] ?? []) {
        const q = toCanvas(s.lat, s.lon)!; const inShort = ws.shortlist.some(x => sameItem(x, s));
        g.fillStyle = inShort ? '#ffd27a' : '#e8f6fb'; g.beginPath(); g.arc(q[0], q[1], view.s > 3 ? 3.5 : 2, 0, 7); g.fill();
        if (view.s > 6 && r.id === sel && !placed.some(([a, b]) => Math.abs(a - q[0]) < 110 && Math.abs(b - q[1]) < 16)) {
          placed.push(q); g.font = '11px Inter, sans-serif'; const tw = g.measureText(s.name).width;
          g.fillStyle = 'rgba(4,8,16,.7)'; g.fillRect(q[0] + 4, q[1] - 7, tw + 6, 15); g.fillStyle = 'rgba(232,246,251,.95)'; g.fillText(s.name, q[0] + 7, q[1] + 4);
        }
      }
      g.font = `${on ? 600 : 500} 12px Inter, sans-serif`; const lab = r.name + (cur ? '  •' : '');
      const tw = g.measureText(lab).width, lx = p[0] + Math.max(half, 5) + 6, ly = p[1] - 4;
      g.fillStyle = 'rgba(4,8,16,.78)'; g.fillRect(lx - 4, ly - 12, tw + 8, 17);
      g.fillStyle = on ? '#ffd27a' : '#e8f1fa'; g.fillText(lab, lx, ly);
    }
    // scale bar
    const km = [10, 20, 50, 100].find(k => k * 1000 / pm.pxM * view.s > 70) ?? 100; const L = km * 1000 / pm.pxM * view.s;
    g.fillStyle = '#fff'; g.fillRect(14, H - 22, L, 3); g.font = '10px JetBrains Mono, monospace'; g.fillText(`${km} km`, 14, H - 28);
  }, [pm, img, view, W, H, sel, ws.regions, ws.regionId, ws.shortlist, regionSites, showGrid, tiles, wantTiles, detail]); // eslint-disable-line react-hooks/exhaustive-deps

  // interaction: drag to pan, wheel / buttons to zoom, click to select the nearest region
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => { const r = cv.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as [number, number]; };
  const zoomAt = (cx: number, cy: number, f: number) => setView(v => { const s = Math.max(Math.min(W, H) / (pm?.size ?? 1000) * 0.8, Math.min(60, v.s * f)); const k = s / v.s; return { s, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k }; });
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const [x, y] = local(e); zoomAt(x, y, e.deltaY < 0 ? 1.25 : 0.8); };
    c.addEventListener('wheel', onWheel, { passive: false }); return () => c.removeEventListener('wheel', onWheel);
  });
  const onDown = (e: RPE<HTMLCanvasElement>) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }; };
  const onMove = (e: RPE<HTMLCanvasElement>) => {
    const [x, y] = local(e); setHover(fromCanvas(x, y));
    const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setView(v => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }));
  };
  const onUp = (e: RPE<HTMLCanvasElement>) => {
    const d = drag.current; drag.current = null; if (!d || d.moved) return;
    const [x, y] = local(e); let best = '', bd = 40;
    for (const r of ws.regions) { const p = toCanvas(r.lat, r.lon)!; const dd = Math.hypot(p[0] - x, p[1] - y); if (dd < bd) { bd = dd; best = r.id; } }
    if (best) setSel(best);
  };
  const zoomTo = (id: string) => { const r = ws.regions.find(x => x.id === id); const p = r && toImg(r.lat, r.lon); if (!p) return; const s = 8; setView({ s, tx: W / 2 - p[0] * s, ty: H / 2 - p[1] * s }); setSel(id); };

  const reg = ws.regions.find(r => r.id === sel);
  const sites = regionSites[sel] ?? [];
  const toggleShort = (s: SiteRef) => {
    const it = { regionId: s.regionId, siteId: s.siteId };
    ws.setShortlist(ws.shortlist.some(x => sameItem(x, it)) ? ws.shortlist.filter(x => !sameItem(x, it)) : [...ws.shortlist, it].slice(-4));
  };

  return (
    <div className="grid-explorer">
      <Panel title={<>Lunar south pole <span className="muted">· {ws.regions.length} analysed regions · drag to pan, scroll or +/− to zoom, click a box</span></>} className="viewport"
        right={<div className="seg"><button onClick={() => zoomAt(W / 2, H / 2, 1.5)} aria-label="Zoom in">＋</button><button onClick={() => zoomAt(W / 2, H / 2, 1 / 1.5)} aria-label="Zoom out">−</button><button onClick={fit}>Reset</button><button className={showGrid ? 'on' : ''} onClick={() => setShowGrid(!showGrid)}>Grid</button>
          <select className="sel" value={detail} onChange={e => setDetail(e.target.value as 'relief')} aria-label="Detail layer when zoomed in"><option value="relief">40 m relief</option><option value="sun">40 m yearly sunlight</option><option value="off">No detail layer</option></select></div>}>
        <div ref={box} className="polemap" style={{ height: H }}>
          {err ? <div className="empty">{err}</div> : !pm || !img ? <div className="empty"><div className="spinner" />Loading LOLA map…</div> : null}
          <canvas ref={cv} style={{ width: W, height: H, cursor: drag.current ? 'grabbing' : 'crosshair', touchAction: 'none' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)} role="img"
            aria-label="Shaded-relief map of the lunar south pole with the LUNARIS analysis regions" />
        </div>
        <div className="vp-foot mono small">
          <span>{hover ? <>Cursor {fmtLatLon(hover[0], hover[1])} · {(((90 + hover[0]) * D) * (pm?.R ?? 1737400) / 1000).toFixed(1)} km from pole</> : 'Move the cursor over the map for coordinates'}</span>
        </div>
        <p className="note">{pm?.source}. {pm?.projection}. Boxes are the 8 × 8 km analysis regions (to scale); dots are candidate landing sites. Zoom in to see LUNARIS's own 40 m layers (relief or yearly sunlight) inside each box.</p>
      </Panel>
      <div className="side">
        <Panel title="Regions">
          <div className="reglist" role="listbox" aria-label="Analysis regions">
            {ws.regions.map(r => <button key={r.id} role="option" aria-selected={r.id === sel} className={r.id === sel ? 'on' : ''} onClick={() => zoomTo(r.id)}>
              <b>{r.name}</b><span className="mono">{fmtLatLon(r.lat, r.lon)}</span>
              <span className="bars"><i className="sunbar" style={{ width: `${r.siteSun * 100}%` }} /><i className="earthbar" style={{ width: `${r.siteEarth * 100}%` }} /></span>
            </button>)}
          </div>
          <p className="note"><span className="lg sun" />site sunlight (year) <span className="lg earth" />site Earth view (year)</p>
        </Panel>
        {reg && <Panel title={reg.name} right={reg.id === ws.regionId ? <Badge tone="info">OPEN</Badge> : null}>
          <div className="kv"><span>Centre</span><b className="mono">{fmtLatLon(reg.lat, reg.lon)}</b></div>
          <div className="kv"><span>Distance from pole</span><b className="mono">{((90 + reg.lat) * D * 1737.4).toFixed(1)} km</b></div>
          <div className="stats2">
            <Stat label="Sunlight at site (2027)" value={(reg.siteSun * 100).toFixed(0)} unit="%" tone="info" />
            <Stat label="Earth in view (2027)" value={(reg.siteEarth * 100).toFixed(0)} unit="%" tone="info" />
            <Stat label="Region avg sunlight" value={(reg.sunAvg * 100).toFixed(0)} unit="%" />
            <Stat label="Cold-trap targets" value={reg.targets} />
          </div>
          <h4>Candidate sites</h4>
          {sites.map(s => { const on = ws.shortlist.some(x => sameItem(x, s)); return (
            <div key={s.siteId} className="siterow">
              <div><b>{s.name}</b><div className="mono small muted">{fmtLatLon(s.lat, s.lon)}</div></div>
              <div className="row0">
                <button className="btn ghost" onClick={() => ws.openSite(s.regionId, s.siteId, 'sky')}>Sun & Earth</button>
                <button className={`btn ${on ? 'on' : ''}`} onClick={() => toggleShort(s)} aria-pressed={on}>{on ? '✓ In compare' : '+ Compare'}</button>
              </div>
            </div>); })}
          <button className="btn primary wide" onClick={() => ws.openSite(reg.id, sites[0]?.siteId ?? '', 'overview')}>Open region in Mission Command →</button>
          <p className="note">Yearly values are for the region's named site with a 2 m mast, from LUNARIS horizon + JPL DE421 computations for 2027.</p>
        </Panel>}
      </div>
    </div>
  );
}
