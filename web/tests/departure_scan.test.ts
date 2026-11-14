// Departure-window scan on real data (Malapert Massif → PSR-1 edge → back), same code as the app.
import { readFileSync, writeFileSync } from 'node:fs';
import { idx } from '../src/engine/dataset';
import { defaultRover, planTraverse } from '../src/engine/planner';
const src = readFileSync(new URL('./planner_real.test.ts', import.meta.url), 'utf8');
void src;
import type { Dataset, Meta } from '../src/engine/dataset';
function load(id: string): Dataset {
  const base = new URL(`../public/data/${id}/`, import.meta.url);
  const meta: Meta = JSON.parse(readFileSync(new URL('meta.json', base), 'utf8'));
  const f = (n: string) => readFileSync(new URL(meta.files[n], base));
  const eph = JSON.parse(f('ephem').toString());
  const W = meta.width, H = meta.height, N = W * H, cell = meta.cellSize;
  const dx = new Float32Array(N), dy = new Float32Array(N);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const i = r * W + c; dx[i] = meta.x0 + (c + 0.5) * cell; dy[i] = meta.y0 - (r + 0.5) * cell; }
  const f32 = (n: string) => { const b = f(n); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
  const u8 = (n: string) => new Uint8Array(f(n));
  return { meta, ephem: eph, W, H, N, cell, elev: f32('elevation'), slope: f32('slope'), rough: f32('rough'), horizon: u8('horizon'), sunAnnual: u8('sunAnnual'),
    earthAnnual: u8('earthAnnual'), psr: u8('psr'), dx, dy, t0ms: Date.parse(eph.t0), hours: eph.sunAz.length, elevMin: 0, elevMax: 1 };
}
const res: Record<string, unknown> = {};
for (const id of ['malapert', 'haworth', 'connecting-ridge-roi4', 'nobile-rim-1', 'im2-athena']) {
  const ds = load(id); const s0 = ds.meta.sites[0]; const s = idx(ds, s0.cell[0], s0.cell[1]); const t = ds.meta.targets[0];
  const g = idx(ds, t.edgeCell[0], t.edgeCell[1]);
  let both = 0, sunOnly = 0, none = 0, shortOnly = 0;
  for (let h = 14 * 24; h < 44 * 24; h += 12) {
    const r = planTraverse(ds, [s, g, s], h, defaultRover, undefined, 150000);
    if (r.shortest.ok && r.sunAware.ok) both++; else if (r.sunAware.ok) sunOnly++; else if (r.shortest.ok) shortOnly++; else none++;
  }
  res[id] = { slots: 60, both, sunAwareOnly: sunOnly, shortestOnly: shortOnly, neither: none, target: t.id };
  console.log(id, res[id]);
}
writeFileSync(new URL('./departure_scan_results.json', import.meta.url), JSON.stringify({ window: '2027-01-15 + 30 days, every 12 h', rover: defaultRover, results: res }, null, 2));
