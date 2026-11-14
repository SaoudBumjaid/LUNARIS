// LUNARIS dataset loader + geometry helpers (mirror of pipeline/lunaris/core.py conventions)

export interface Site { id: string; name: string; cell: [number, number]; origin: string }
export interface Target { id: string; areaKm2: number; centroid: [number, number]; edgeCell: [number, number]; status: string; note: string }
export interface Provenance { item: string; source: string; resolution: string; date: string; real: boolean }

export interface Meta {
  mode: 'demo' | 'real'; regionName: string; width: number; height: number; cellSize: number;
  x0: number; y0: number; naz: number; hzScale: number; hzOffset: number; sunRadiusDeg: number; R: number;
  center: { x: number; y: number; lat: number; lon: number }; observerHeightM: number;
  sites: Site[]; targets: Target[]; provenance: Provenance[]; warnings: string[];
  files: Record<string, string>; projection: string; grid?: 'enu' | 'stereo'; regionId?: string;
}
export interface RegionInfo { id: string; name: string; lat: number; lon: number; sunAvg: number; earthAvg: number; siteSun: number; siteEarth: number; psrPct: number; targets: number }

export async function loadRegions(): Promise<RegionInfo[]> {
  try { const r = await fetch('./data/regions.json'); if (!r.ok) return []; return (await r.json()).regions ?? []; } catch { return []; }
}
export interface Ephem { t0: string; stepHours: number; sunAz: number[]; sunEl: number[]; earthAz: number[]; earthEl: number[]; source: string }

export interface Dataset {
  meta: Meta; ephem: Ephem; W: number; H: number; N: number; cell: number;
  elev: Float32Array; slope: Float32Array; rough: Float32Array; horizon: Uint8Array;
  sunAnnual: Uint8Array; earthAnnual: Uint8Array; psr: Uint8Array;
  dx: Float32Array; dy: Float32Array; t0ms: number; hours: number;
  elevMin: number; elevMax: number;
}

async function bin(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to load ${url} (${r.status})`);
  // Hosts that do not serve binary files get the same bytes as base64 text (*.b64.txt).
  if (url.endsWith('.b64.txt')) { const s = atob((await r.text()).trim()); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
  return r.arrayBuffer();
}

export async function loadDataset(base = './data/'): Promise<Dataset> {
  const mr = await fetch(base + 'meta.json');
  if (!mr.ok) throw new Error('meta.json not found — run the pipeline (pipeline/build_open.py).');
  const meta: Meta = await mr.json();
  const f = meta.files;
  const [eph, e, s, ro, hz, sa, ea, p] = await Promise.all([
    fetch(base + f.ephem).then(r => r.json()),
    bin(base + f.elevation), bin(base + f.slope), bin(base + f.rough), bin(base + f.horizon),
    bin(base + f.sunAnnual), bin(base + f.earthAnnual), bin(base + f.psr),
  ]);
  const W = meta.width, H = meta.height, N = W * H, cell = meta.cellSize;
  const dx = new Float32Array(N), dy = new Float32Array(N);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c;
    dx[i] = meta.x0 + (c + 0.5) * cell - meta.center.x;
    dy[i] = meta.y0 - (r + 0.5) * cell - meta.center.y;
  }
  const elev = new Float32Array(e);
  let mn = Infinity, mx = -Infinity;
  for (const v of elev) { if (v < mn) mn = v; if (v > mx) mx = v; }
  return {
    meta, ephem: eph, W, H, N, cell, elev, slope: new Float32Array(s), rough: new Float32Array(ro),
    horizon: new Uint8Array(hz), sunAnnual: new Uint8Array(sa), earthAnnual: new Uint8Array(ea), psr: new Uint8Array(p),
    dx, dy, t0ms: Date.parse(eph.t0), hours: eph.sunAz.length, elevMin: mn, elevMax: mx,
  };
}

// ---------------------------------------------------------------- geometry
export const idx = (ds: Dataset, r: number, c: number) => r * ds.W + c;
export const rc = (ds: Dataset, i: number): [number, number] => [Math.floor(i / ds.W), i % ds.W];

export function cellXY(ds: Dataset, i: number): [number, number] {
  const [r, c] = rc(ds, i);
  return [ds.meta.x0 + (c + 0.5) * ds.cell, ds.meta.y0 - (r + 0.5) * ds.cell];
}

export function xyToLatLon(x: number, y: number, R = 1737400): [number, number] {
  const rho = Math.hypot(x, y);
  const lat = 2 * Math.atan(rho / (2 * R)) - Math.PI / 2;
  return [lat * 180 / Math.PI, Math.atan2(x, y) * 180 / Math.PI];
}

// Local east/north grid: great-circle offset (x east, y north, metres) from the region centre.
export function enuToLatLon(lat0: number, lon0: number, x: number, y: number, R = 1737400): [number, number] {
  const d = Math.hypot(x, y) / R, az = Math.atan2(x, y), la = lat0 * Math.PI / 180, lo = lon0 * Math.PI / 180;
  const lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(az));
  const lon = lo + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
  return [lat * 180 / Math.PI, ((lon * 180 / Math.PI + 540) % 360) - 180];
}

export function cellLatLon(ds: Dataset, i: number) {
  const [x, y] = cellXY(ds, i);
  return ds.meta.grid === 'enu' ? enuToLatLon(ds.meta.center.lat, ds.meta.center.lon, x, y, ds.meta.R) : xyToLatLon(x, y, ds.meta.R);
}

export function fmtLatLon(lat: number, lon: number) {
  return `${Math.abs(lat).toFixed(4)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}°${lon < 0 ? 'W' : 'E'}`;
}

export const hourToDate = (ds: Dataset, h: number) => new Date(ds.t0ms + h * 3600e3);
export const dateToHour = (ds: Dataset, d: Date) => Math.max(0, Math.min(ds.hours - 1, Math.round((d.getTime() - ds.t0ms) / 3600e3)));
export const fmtDate = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
