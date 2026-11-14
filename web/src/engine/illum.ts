// Terrain-aware illumination & Earth line-of-sight, computed from horizon masks.
import type { Dataset } from './dataset';

const D2R = Math.PI / 180;

/** Scenario perturbations used by the What-If simulator (reset to defaults after each run). */
export const perturb = { horizonBiasDeg: 0, dteOutage: null as null | [number, number] };
export function withPerturb<T>(p: Partial<typeof perturb>, fn: () => T): T {
  const old = { ...perturb }; Object.assign(perturb, p);
  try { return fn(); } finally { Object.assign(perturb, old); }
}

/** Horizon elevation (deg) at cell i for grid azimuth az (deg), linear between 5° bins. */
export function horizonAt(ds: Dataset, i: number, az: number): number {
  const naz = ds.meta.naz;
  const f = (((az % 360) + 360) % 360) / (360 / naz);
  const b0 = Math.floor(f) % naz, b1 = (b0 + 1) % naz, w = f - Math.floor(f);
  const base = i * naz;
  const h0 = ds.horizon[base + b0] / ds.meta.hzScale - ds.meta.hzOffset;
  const h1 = ds.horizon[base + b1] / ds.meta.hzScale - ds.meta.hzOffset;
  return h0 * (1 - w) + h1 * w + perturb.horizonBiasDeg;
}

/** Elevation of a body seen from cell i (deg), corrected from the region centre for the local vertical. */
function bodyEl(ds: Dataset, i: number, az: number, elC: number) {
  const a = az * D2R;
  return elC + ((ds.dx[i] * Math.sin(a) + ds.dy[i] * Math.cos(a)) / ds.meta.R) / D2R;
}

const hClamp = (ds: Dataset, h: number) => Math.max(0, Math.min(ds.hours - 1, Math.floor(h)));

/** Visible fraction of the solar disc (0..1) at cell i, hour h. */
export function sunFrac(ds: Dataset, i: number, h: number): number {
  const t = hClamp(ds, h);
  const az = ds.ephem.sunAz[t];
  const el = bodyEl(ds, i, az, ds.ephem.sunEl[t]);
  const r = ds.meta.sunRadiusDeg;
  const x = (el - horizonAt(ds, i, az)) / (2 * r) + 0.5;
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

/** Geometric direct-to-Earth line of sight (Earth centre above terrain horizon). */
export function earthVis(ds: Dataset, i: number, h: number): boolean {
  const t = hClamp(ds, h);
  if (perturb.dteOutage && h >= perturb.dteOutage[0] && h < perturb.dteOutage[1]) return false;
  const az = ds.ephem.earthAz[t];
  return bodyEl(ds, i, az, ds.ephem.earthEl[t]) > horizonAt(ds, i, az);
}

/** Pure geometric (no terrain) Sun elevation at cell i — for the geometric-vs-terrain comparison. */
export function sunElGeom(ds: Dataset, i: number, h: number) {
  const t = hClamp(ds, h); return bodyEl(ds, i, ds.ephem.sunAz[t], ds.ephem.sunEl[t]);
}
export function earthElGeom(ds: Dataset, i: number, h: number) {
  const t = hClamp(ds, h); return bodyEl(ds, i, ds.ephem.earthAz[t], ds.ephem.earthEl[t]);
}

export function sunGrid(ds: Dataset, h: number): Float32Array {
  const g = new Float32Array(ds.N);
  for (let i = 0; i < ds.N; i++) g[i] = sunFrac(ds, i, h);
  return g;
}
export function earthGrid(ds: Dataset, h: number): Uint8Array {
  const g = new Uint8Array(ds.N);
  for (let i = 0; i < ds.N; i++) g[i] = earthVis(ds, i, h) ? 1 : 0;
  return g;
}

export interface WindowStats {
  sunPct: number; earthPct: number; bothPct: number;
  longestDarkH: number; longestBlackoutH: number; firstDarkH: number | null;
  series: { h: number; sun: number; earth: number; sunEl: number; sunHz: number; earthEl: number; earthHz: number }[];
}

/** Statistics at one cell over [h0, h0+dur) hours. Darkness = <50% of the solar disc visible. */
export function windowStats(ds: Dataset, i: number, h0: number, dur: number, seriesStep = 3): WindowStats {
  let sun = 0, earth = 0, both = 0, dark = 0, maxDark = 0, bo = 0, maxBo = 0, firstDark: number | null = null;
  const series: WindowStats['series'] = [];
  const end = Math.min(ds.hours, h0 + dur);
  let n = 0;
  for (let h = h0; h < end; h++, n++) {
    const s = sunFrac(ds, i, h), e = earthVis(ds, i, h);
    sun += s; if (e) earth++; if (s > 0.5 && e) both++;
    if (s < 0.5) { dark++; if (firstDark === null) firstDark = h - h0; } else dark = 0;
    if (!e) bo++; else bo = 0;
    maxDark = Math.max(maxDark, dark); maxBo = Math.max(maxBo, bo);
    if ((h - h0) % seriesStep === 0) {
      const t = hClamp(ds, h);
      series.push({
        h: h - h0, sun: s, earth: e ? 1 : 0,
        sunEl: sunElGeom(ds, i, h), sunHz: horizonAt(ds, i, ds.ephem.sunAz[t]),
        earthEl: earthElGeom(ds, i, h), earthHz: horizonAt(ds, i, ds.ephem.earthAz[t]),
      });
    }
  }
  n = Math.max(1, n);
  return { sunPct: 100 * sun / n, earthPct: 100 * earth / n, bothPct: 100 * both / n, longestDarkH: maxDark, longestBlackoutH: maxBo, firstDarkH: firstDark, series };
}
