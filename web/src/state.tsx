import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Dataset, Site } from './engine/dataset';
import { idx } from './engine/dataset';
import { windowStats } from './engine/illum';
import { defaultLander, defaultWeights, type LanderParams, type Weights } from './engine/sites';
import { defaultRover, type RoverParams, type RouteResult } from './engine/planner';
import type { LayerKey } from './engine/layers';

export interface Mission {
  ds: Dataset;
  hour: number; setHour: (h: number) => void;              // selected display time
  startH: number; setStartH: (h: number) => void;           // mission start (landing)
  durDays: number; setDurDays: (d: number) => void;
  layer: LayerKey; setLayer: (l: LayerKey) => void;
  sites: Site[]; setSites: (s: Site[]) => void;
  siteId: string; setSiteId: (s: string) => void;
  selected: number | null; setSelected: (c: number | null) => void;
  lander: LanderParams; setLander: (p: LanderParams) => void;
  weights: Weights; setWeights: (w: Weights) => void;
  rover: RoverParams; setRover: (p: RoverParams) => void;
  waypoints: number[]; setWaypoints: (w: number[]) => void;
  routes: { shortest: RouteResult; sunAware: RouteResult } | null; setRoutes: (r: Mission['routes']) => void;
  siteCell: number;
}

const Ctx = createContext<Mission | null>(null);
export const useMission = () => { const m = useContext(Ctx); if (!m) throw new Error('no mission'); return m; };

export function MissionProvider({ ds, children, initialSiteId }: { ds: Dataset; children: ReactNode; initialSiteId?: string }) {
  // Default landing time: best Sun+Earth 14-day window for the first site within the first 60 days.
  const initStart = useMemo(() => {
    const s0 = ds.meta.sites.find(s => s.id === initialSiteId) ?? ds.meta.sites[0]; if (!s0) return 0; const c = idx(ds, s0.cell[0], s0.cell[1]);
    let best = 0, bv = -1;
    for (let h = 0; h < Math.min(ds.hours - 14 * 24, 60 * 24); h += 12) { const w = windowStats(ds, c, h, 14 * 24, 1000); const v = w.sunPct + 0.5 * w.earthPct - 0.3 * w.longestDarkH; if (v > bv) { bv = v; best = h; } }
    return best;
  }, [ds]);
  const [hour, setHour] = useState(initStart);
  const [startH, setStartH] = useState(initStart);
  const [durDays, setDurDays] = useState(14);
  const [layer, setLayer] = useState<LayerKey>('sunNow');
  const [sites, setSites] = useState<Site[]>(ds.meta.sites);
  const [siteId, setSiteId] = useState((ds.meta.sites.find(s => s.id === initialSiteId) ?? ds.meta.sites[0])?.id ?? '');
  const [selected, setSelected] = useState<number | null>(null);
  const [lander, setLander] = useState(defaultLander);
  const [weights, setWeights] = useState(defaultWeights);
  const [rover, setRover] = useState(defaultRover);
  const site = sites.find(s => s.id === siteId) ?? sites[0];
  const siteCell = site ? idx(ds, site.cell[0], site.cell[1]) : Math.floor(ds.N / 2);
  const [waypoints, setWaypoints] = useState<number[]>(() => {
    const t = ds.meta.targets[0];
    return t ? [siteCell, idx(ds, t.edgeCell[0], t.edgeCell[1]), siteCell] : [siteCell];
  });
  const [routes, setRoutes] = useState<Mission['routes']>(null);
  const v = useMemo(() => ({
    ds, hour, setHour, startH, setStartH, durDays, setDurDays, layer, setLayer, sites, setSites, siteId, setSiteId,
    selected, setSelected, lander, setLander, weights, setWeights, rover, setRover, waypoints, setWaypoints, routes, setRoutes, siteCell,
  }), [ds, hour, startH, durDays, layer, sites, siteId, selected, lander, weights, rover, waypoints, routes, siteCell]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
