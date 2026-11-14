// Layer colouring shared by the 2-D map and the 3-D terrain.
import type { Dataset } from './dataset';
import { earthGrid, sunGrid } from './illum';

export type LayerKey = 'elevation' | 'slope' | 'hazard' | 'sunNow' | 'earthNow' | 'sunAnnual' | 'earthAnnual' | 'psr';
export const LAYERS: { key: LayerKey; label: string; legend: string }[] = [
  { key: 'elevation', label: 'Elevation (hillshade)', legend: 'NASA LOLA heights, hillshaded' },
  { key: 'slope', label: 'Slope', legend: 'green < 8° · yellow 8–15° · orange 15–25° · red > 25°' },
  { key: 'hazard', label: 'Landing hazard', legend: 'Slope vs lander limit + roughness' },
  { key: 'sunNow', label: 'Sunlight at selected time', legend: 'Terrain-aware: visible solar-disc fraction' },
  { key: 'earthNow', label: 'Earth line-of-sight now', legend: 'Cyan = Earth centre above terrain horizon' },
  { key: 'sunAnnual', label: 'Annual illumination %', legend: 'Mean solar-disc visibility over ephemeris span' },
  { key: 'earthAnnual', label: 'Annual Earth visibility %', legend: 'Fraction of time with geometric DTE' },
  { key: 'psr', label: 'Permanently shadowed (computed)', legend: 'Violet = never sunlit in span (inferred cold trap)' },
];

type RGB = [number, number, number];
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function ramp(stops: RGB[], t: number): RGB {
  t = Math.max(0, Math.min(1, t)); const s = t * (stops.length - 1); const i = Math.min(stops.length - 2, Math.floor(s));
  return lerp(stops[i], stops[i + 1], s - i);
}
const SUN: RGB[] = [[8, 10, 16], [60, 52, 40], [180, 140, 70], [232, 184, 92], [255, 236, 190]];
const CYAN: RGB[] = [[10, 14, 22], [30, 70, 90], [88, 199, 217]];
const SLOPE_C = (s: number): RGB => s < 8 ? [52, 168, 83] : s < 15 ? [222, 196, 60] : s < 25 ? [245, 158, 11] : [239, 68, 68];

export function hillshade(ds: Dataset): Float32Array {
  const out = new Float32Array(ds.N); const az = 315 * Math.PI / 180, alt = 35 * Math.PI / 180;
  for (let r = 0; r < ds.H; r++) for (let c = 0; c < ds.W; c++) {
    const i = r * ds.W + c;
    const zl = ds.elev[r * ds.W + Math.max(0, c - 1)], zr = ds.elev[r * ds.W + Math.min(ds.W - 1, c + 1)];
    const zu = ds.elev[Math.max(0, r - 1) * ds.W + c], zd = ds.elev[Math.min(ds.H - 1, r + 1) * ds.W + c];
    const dzdx = (zr - zl) / (2 * ds.cell), dzdy = (zu - zd) / (2 * ds.cell);
    const slope = Math.atan(Math.hypot(dzdx, dzdy)); const aspect = Math.atan2(dzdy, -dzdx);
    out[i] = Math.max(0, Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect));
  }
  return out;
}

let hsCache: { ds: Dataset; hs: Float32Array } | null = null;
export const getHillshade = (ds: Dataset) => (hsCache?.ds === ds ? hsCache.hs : (hsCache = { ds, hs: hillshade(ds) }).hs);

/** Returns RGB (0..255) per cell for a layer. */
export function layerColors(ds: Dataset, layer: LayerKey, hour: number, landerMaxSlope = 12): Uint8ClampedArray {
  const out = new Uint8ClampedArray(ds.N * 3); const hs = getHillshade(ds);
  const sun = layer === 'sunNow' ? sunGrid(ds, hour) : null;
  const earth = layer === 'earthNow' ? earthGrid(ds, hour) : null;
  const span = ds.elevMax - ds.elevMin || 1;
  for (let i = 0; i < ds.N; i++) {
    const shade = 0.35 + 0.65 * hs[i];
    let col: RGB;
    switch (layer) {
      case 'elevation': { const t = (ds.elev[i] - ds.elevMin) / span; const g = 40 + 170 * shade; col = lerp([g * 0.85, g * 0.88, g * 0.95], [g, g, g], t); break; }
      case 'slope': col = lerp([20, 20, 24], SLOPE_C(ds.slope[i]), 0.35 + 0.65 * shade); break;
      case 'hazard': {
        const s = ds.slope[i], rough = ds.rough[i];
        const v = s > landerMaxSlope || rough > 0.16 * ds.cell ? 2 : s > landerMaxSlope * 0.66 || rough > 0.08 * ds.cell ? 1 : 0;
        const base: RGB = v === 2 ? [239, 68, 68] : v === 1 ? [245, 158, 11] : [70, 160, 110];
        col = lerp([15, 15, 18], base, 0.3 + 0.7 * shade); break;
      }
      case 'sunNow': { const dark: RGB = [12 + 40 * shade, 13 + 42 * shade, 18 + 48 * shade]; const lit: RGB = [70 + 185 * shade, 55 + 150 * shade, 25 + 80 * shade]; col = lerp(dark, lit, sun![i]); break; }
      case 'earthNow': col = earth![i] ? lerp([20, 60, 80], [88, 199, 217], shade) : lerp([8, 9, 12], [70, 70, 78], shade); break;
      case 'sunAnnual': col = lerp([5, 6, 10], ramp(SUN, ds.sunAnnual[i] / 200 / 0.8), 0.45 + 0.55 * shade); break;
      case 'earthAnnual': col = lerp([5, 6, 10], ramp(CYAN, ds.earthAnnual[i] / 200 / 0.6), 0.45 + 0.55 * shade); break;
      case 'psr': { const g = 30 + 150 * shade; col = ds.psr[i] ? [110 + 40 * shade, 70, 200] : [g, g, g]; break; }
    }
    out[i * 3] = col[0]; out[i * 3 + 1] = col[1]; out[i * 3 + 2] = col[2];
  }
  return out;
}
