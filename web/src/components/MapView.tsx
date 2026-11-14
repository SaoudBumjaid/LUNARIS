import { useEffect, useMemo, useRef, useState } from 'react';
import { useMission } from '../state';
import { cellLatLon, fmtLatLon, idx, rc } from '../engine/dataset';
import { layerColors, type LayerKey } from '../engine/layers';
import { sunFrac, earthVis } from '../engine/illum';
import type { Step } from '../engine/planner';

export interface Overlay {
  routes?: { steps: Step[]; color: string; dash?: boolean }[];
  ellipse?: { cell: number; radiusM: number };
  blocked?: Set<number>;
  waypoints?: number[];
}

export function MapView({ layer, hour, onPick, overlay, size = 560 }: { layer?: LayerKey; hour?: number; onPick?: (cell: number, e: React.MouseEvent) => void; overlay?: Overlay; size?: number }) {
  const m = useMission(); const ds = m.ds;
  const L = layer ?? m.layer, H = hour ?? m.hour;
  const base = useRef<HTMLCanvasElement>(null), top = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const scale = size / Math.max(ds.W, ds.H);
  const colors = useMemo(() => layerColors(ds, L, H, m.lander.maxLanderSlope), [ds, L, H, m.lander.maxLanderSlope]);

  useEffect(() => {
    const cv = base.current!; cv.width = ds.W; cv.height = ds.H;
    const ctx = cv.getContext('2d')!; const img = ctx.createImageData(ds.W, ds.H);
    for (let i = 0; i < ds.N; i++) { img.data[i * 4] = colors[i * 3]; img.data[i * 4 + 1] = colors[i * 3 + 1]; img.data[i * 4 + 2] = colors[i * 3 + 2]; img.data[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  }, [colors, ds]);

  useEffect(() => {
    const cv = top.current!; cv.width = size; cv.height = size; const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);
    const P = (cell: number) => { const [r, c] = rc(ds, cell); return [(c + 0.5) * scale, (r + 0.5) * scale] as const; };
    if (overlay?.blocked) { ctx.fillStyle = 'rgba(239,68,68,0.45)'; for (const b of overlay.blocked) { const [x, y] = P(b); ctx.fillRect(x - scale / 2, y - scale / 2, scale, scale); } }
    if (overlay?.ellipse) {
      const [x, y] = P(overlay.ellipse.cell); ctx.strokeStyle = '#E8B85C'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(x, y, overlay.ellipse.radiusM / ds.cell * scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const rt of overlay?.routes ?? []) {
      if (rt.steps.length < 2) continue; ctx.strokeStyle = rt.color; ctx.lineWidth = 2.4; ctx.setLineDash(rt.dash ? [6, 4] : []);
      ctx.beginPath(); rt.steps.forEach((s, k) => { const [x, y] = P(s.cell); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = rt.color; for (const s of rt.steps) if (s.kind === 'wait') { const [x, y] = P(s.cell); ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 7); ctx.fill(); }
    }
    for (const t of ds.meta.targets) {
      const [x, y] = P(idx(ds, t.centroid[0], t.centroid[1]));
      ctx.strokeStyle = '#A78BFA'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = '#C4B5FD'; ctx.font = '10px Inter, system-ui, sans-serif'; ctx.fillText(t.id, x + 8, y + 3);
    }
    (overlay?.waypoints ?? []).forEach((w, k) => {
      const [x, y] = P(w); ctx.fillStyle = '#58C7D9'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
      ctx.fillStyle = '#05070B'; ctx.font = 'bold 9px Inter, system-ui, sans-serif'; ctx.fillText(String(k), x - 2.6, y + 3.2);
    });
    for (const s of m.sites) {
      const [x, y] = P(idx(ds, s.cell[0], s.cell[1])); const sel = s.id === m.siteId;
      ctx.fillStyle = sel ? '#E8B85C' : '#C7CBD1'; ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x - 5, y + 4); ctx.closePath(); ctx.fill();
      ctx.font = `${sel ? 'bold ' : ''}11px Inter, system-ui, sans-serif`; ctx.fillText(s.name, x + 8, y + 4);
    }
    if (m.selected !== null) { const [x, y] = P(m.selected); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x - 5, y - 5, 10, 10); }
  }, [overlay, m.sites, m.siteId, m.selected, ds, scale, size]);

  const toCell = (e: React.MouseEvent) => {
    const r = (e.target as HTMLElement).getBoundingClientRect();
    const c = Math.floor((e.clientX - r.left) / scale), rr = Math.floor((e.clientY - r.top) / scale);
    return rr >= 0 && c >= 0 && rr < ds.H && c < ds.W ? idx(ds, rr, c) : null;
  };
  const hv = hover !== null ? (() => { const [la, lo] = cellLatLon(ds, hover); return { ll: fmtLatLon(la, lo), z: ds.elev[hover], s: ds.slope[hover], sun: sunFrac(ds, hover, H), e: earthVis(ds, hover, H), ann: ds.sunAnnual[hover] / 2, psr: ds.psr[hover] }; })() : null;

  return (
    <div className="map-wrap" style={{ width: size }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <canvas ref={base} style={{ width: size, height: size, imageRendering: 'pixelated', position: 'absolute', inset: 0 }} />
        <canvas ref={top} style={{ position: 'absolute', inset: 0, cursor: onPick ? 'crosshair' : 'default' }}
          onMouseMove={e => setHover(toCell(e))} onMouseLeave={() => setHover(null)}
          onClick={e => { const c = toCell(e); if (c !== null) { m.setSelected(c); onPick?.(c, e); } }} />
        <div className="scalebar"><span style={{ width: 1000 / ds.cell * scale }} />1 km</div>
        <div className="northbar">{ds.meta.grid === 'enu' ? '↑ north (local east/north grid)' : 'grid ↑ (polar stereographic +y)'}</div>
      </div>
      <div className="readout mono">
        {hv ? <>{hv.ll} · z {hv.z.toFixed(0)} m · slope {hv.s.toFixed(1)}° · sun {(hv.sun * 100).toFixed(0)}% · DTE {hv.e ? 'yes' : 'no'} · annual sun {hv.ann.toFixed(0)}%{hv.psr ? ' · PSR' : ''}</> : 'Hover the map for coordinates and values'}
      </div>
    </div>
  );
}
