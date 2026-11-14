// Transparent multi-criteria landing-site evaluation. Every number is traceable to a formula below.
import type { Dataset } from './dataset';
import { idx, rc } from './dataset';
import { windowStats, type WindowStats } from './illum';

export interface LanderParams {
  ellipseRadiusM: number;      // landing dispersion radius
  maxLanderSlope: number;      // deg, cells above this are "unsafe"
  cautionSlope: number;        // deg
  batteryNightH: number;       // hours the lander can survive in darkness
  minEarthPct: number;         // required DTE time %
}
export const defaultLander: LanderParams = { ellipseRadiusM: 150, maxLanderSlope: 12, cautionSlope: 8, batteryNightH: 50, minEarthPct: 40 };

export type Criterion = 'safety' | 'power' | 'survival' | 'comms' | 'science' | 'confidence';
export const CRITERIA: { key: Criterion; label: string; formula: string }[] = [
  { key: 'safety', label: 'Terrain safety', formula: '100 × (1 − unsafe fraction in ellipse) − 2 × max(0, mean slope − caution)' },
  { key: 'power', label: 'Solar availability', formula: 'Mean visible solar-disc fraction over the mission window (%)' },
  { key: 'survival', label: 'Night survival', formula: '100 × clamp(1 − (longest darkness − battery hours) / battery hours)' },
  { key: 'comms', label: 'Earth line-of-sight', formula: 'DTE geometric visibility % ÷ required % (capped at 100)' },
  { key: 'science', label: 'Science access', formula: '100 × clamp(1 − distance to nearest computed PSR edge / 5 km)' },
  { key: 'confidence', label: 'Data confidence', formula: 'Data mode, DEM cell size vs. lander scale, and gap fraction' },
];
export type Weights = Record<Criterion, number>;
export const defaultWeights: Weights = { safety: 3, power: 2, survival: 2, comms: 2, science: 1, confidence: 1 };

export interface SiteEval {
  cell: number; scores: Record<Criterion, number>; overall: number; risk: 'LOW' | 'MODERATE' | 'HIGH';
  evidence: Record<string, string | number>; explanation: string[]; stats: WindowStats;
  unsafeFrac: number; cautionFrac: number; meanSlope: number; maxSlope: number; distPsrM: number;
}

const clamp = (x: number, a = 0, b = 100) => Math.max(a, Math.min(b, x));

export function ellipseCells(ds: Dataset, cell: number, radiusM: number): number[] {
  const [r0, c0] = rc(ds, cell); const rr = Math.ceil(radiusM / ds.cell); const out: number[] = [];
  for (let r = r0 - rr; r <= r0 + rr; r++) for (let c = c0 - rr; c <= c0 + rr; c++) {
    if (r < 0 || c < 0 || r >= ds.H || c >= ds.W) continue;
    if (Math.hypot(r - r0, c - c0) * ds.cell <= radiusM) out.push(idx(ds, r, c));
  }
  return out;
}

let psrEdgeCache: { ds: Dataset; cells: number[] } | null = null;
function psrEdges(ds: Dataset) {
  if (psrEdgeCache?.ds === ds) return psrEdgeCache.cells;
  const cells: number[] = [];
  for (let r = 1; r < ds.H - 1; r++) for (let c = 1; c < ds.W - 1; c++) {
    const i = idx(ds, r, c);
    if (ds.psr[i] && (!ds.psr[i - 1] || !ds.psr[i + 1] || !ds.psr[i - ds.W] || !ds.psr[i + ds.W])) cells.push(i);
  }
  psrEdgeCache = { ds, cells }; return cells;
}
export function distToPsr(ds: Dataset, cell: number) {
  const [r0, c0] = rc(ds, cell); let best = Infinity;
  for (const e of psrEdges(ds)) { const [r, c] = rc(ds, e); const d = Math.hypot(r - r0, c - c0); if (d < best) best = d; }
  return best * ds.cell;
}

export function evaluateSite(ds: Dataset, cell: number, startH: number, durH: number, p: LanderParams, w: Weights): SiteEval {
  const cells = ellipseCells(ds, cell, p.ellipseRadiusM);
  let unsafe = 0, caution = 0, sum = 0, mx = 0;
  for (const i of cells) { const s = ds.slope[i]; sum += s; mx = Math.max(mx, s); if (s > p.maxLanderSlope) unsafe++; else if (s > p.cautionSlope) caution++; }
  const n = Math.max(1, cells.length);
  const unsafeFrac = unsafe / n, cautionFrac = caution / n, meanSlope = sum / n;
  const st = windowStats(ds, cell, startH, durH);
  const dPsr = distToPsr(ds, cell);
  const dataCell = ds.cell;
  const conf = ds.meta.mode === 'demo' ? 15 : clamp(90 - Math.max(0, dataCell - 5) * 0.8);

  const scores: Record<Criterion, number> = {
    safety: clamp(100 * (1 - unsafeFrac) - 2 * Math.max(0, meanSlope - p.cautionSlope)),
    power: clamp(st.sunPct),
    survival: clamp(100 * (1 - Math.max(0, st.longestDarkH - p.batteryNightH) / p.batteryNightH)),
    comms: clamp(100 * st.earthPct / Math.max(1, p.minEarthPct)),
    science: Number.isFinite(dPsr) ? clamp(100 * (1 - dPsr / 5000)) : 0,
    confidence: conf,
  };
  const wsum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const overall = (Object.keys(scores) as Criterion[]).reduce((a, k) => a + scores[k] * w[k], 0) / wsum;
  const hard = scores.safety < 60 || scores.survival < 40 || st.earthPct < p.minEarthPct * 0.5;
  const soft = scores.safety < 85 || scores.survival < 80 || scores.comms < 80;
  const risk = hard ? 'HIGH' : soft ? 'MODERATE' : 'LOW';

  const ex: string[] = [];
  ex.push(`${(unsafeFrac * 100).toFixed(1)}% of the ${p.ellipseRadiusM} m landing ellipse exceeds the ${p.maxLanderSlope}° lander slope limit (mean slope ${meanSlope.toFixed(1)}°, max ${mx.toFixed(1)}°).`);
  ex.push(`The solar disc is on average ${st.sunPct.toFixed(0)}% visible over the ${Math.round(durH / 24)}-day window; the longest continuous darkness is ${st.longestDarkH} h versus a battery budget of ${p.batteryNightH} h.`);
  ex.push(`Earth is geometrically above the terrain horizon ${st.earthPct.toFixed(0)}% of the time (required ${p.minEarthPct}%); longest DTE blackout ${st.longestBlackoutH} h. Line-of-sight is not a radio-link guarantee.`);
  ex.push(Number.isFinite(dPsr) ? `Nearest computed permanently-shadowed region edge is ${(dPsr / 1000).toFixed(2)} km away (inferred cold trap, not confirmed ice).` : 'No permanently shadowed region was computed inside this region.');
  ex.push(ds.meta.mode === 'demo' ? 'Confidence is LOW because this is the synthetic DEMO dataset.' : `Terrain resolution is ${dataCell} m: hazards smaller than ~${2 * dataCell} m (boulders, small craters) are not resolved.`);
  if (hard) ex.push('Risk HIGH because at least one hard constraint (safety < 60, survival < 40, or Earth visibility < half of requirement) is violated.');

  return {
    cell, scores, overall, risk, stats: st, unsafeFrac, cautionFrac, meanSlope, maxSlope: mx, distPsrM: dPsr, explanation: ex,
    evidence: {
      'Ellipse cells': cells.length, 'Unsafe %': +(unsafeFrac * 100).toFixed(1), 'Caution %': +(cautionFrac * 100).toFixed(1),
      'Mean slope °': +meanSlope.toFixed(2), 'Sun %': +st.sunPct.toFixed(1), 'Earth LOS %': +st.earthPct.toFixed(1),
      'Sun+Earth %': +st.bothPct.toFixed(1), 'Longest dark h': st.longestDarkH, 'Longest blackout h': st.longestBlackoutH,
      'Dist. PSR km': Number.isFinite(dPsr) ? +(dPsr / 1000).toFixed(2) : '—',
    },
  };
}
