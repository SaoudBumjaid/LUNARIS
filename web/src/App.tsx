import { useEffect, useMemo, useState } from 'react';
import { loadDataset, loadRegions, type Dataset, type RegionInfo, fmtDate, hourToDate } from './engine/dataset';
import { MissionProvider, useMission } from './state';
import { Overview } from './pages/Overview';
import { Explorer } from './pages/Explorer';
import { Landing } from './pages/Landing';
import { Planner } from './pages/Planner';
import { WhatIf } from './pages/WhatIf';
import { Sources } from './pages/Sources';
import { PoleMap } from './pages/PoleMap';
import { SunEarth } from './pages/SunEarth';
import { Compare } from './pages/Compare';
import { allSites, getDataset, type SiteRef } from './engine/sky';
import { WsCtx, type ShortItem, type Workspace } from './workspace';

const PAGES = [
  { id: 'polemap', label: 'South Pole Map', icon: '⊙', group: 'Explore' },
  { id: 'overview', label: 'Mission Command', icon: '◎', group: 'Explore' },
  { id: 'explorer', label: 'Lunar Explorer', icon: '◐', group: 'Explore' },
  { id: 'sky', label: 'Sun & Earth', icon: '☼', group: 'Analyse' },
  { id: 'compare', label: 'Compare Sites', icon: '▥', group: 'Analyse' },
  { id: 'landing', label: 'Landing Safety', icon: '⊕', group: 'Plan' },
  { id: 'planner', label: 'Traverse Planner', icon: '⟿', group: 'Plan' },
  { id: 'whatif', label: 'What If? Simulator', icon: '⇄', group: 'Plan' },
  { id: 'sources', label: 'Data & Sources', icon: '≡', group: 'About' },
];
const PAGE_IDS = new Set(PAGES.map(p => p.id));

function Shell({ regions, regionId, setRegionId, page, setPage }: { regions: RegionInfo[]; regionId: string; setRegionId: (r: string) => void; page: string; setPage: (p: string) => void }) {
  const m = useMission();
  const site = m.sites.find(s => s.id === m.siteId);
  let lastGroup = '';
  return (
    <div className="app">
      <aside className="nav">
        <div className="brand"><div className="logo">◑</div><div><b>LUNARIS</b><small>Land, then drive.</small></div></div>
        {regions.length > 0 && <label className="region-pick"><span>Region (8 × 8 km)</span>
          <select value={regionId} onChange={e => setRegionId(e.target.value)} aria-label="Choose south-pole region">
            {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></label>}
        <nav aria-label="Pages" className="nav-list">{PAGES.map(p => {
          const head = p.group !== lastGroup ? <div className="nav-group" key={'g' + p.group}>{(lastGroup = p.group)}</div> : null;
          return [head, <button key={p.id} className={page === p.id ? 'on' : ''} aria-current={page === p.id ? 'page' : undefined} onClick={() => setPage(p.id)}><span aria-hidden="true">{p.icon}</span>{p.label}</button>];
        })}</nav>
        <div className="nav-foot">
          <div className={`mode ${m.ds.meta.mode}`}>{m.ds.meta.mode === 'demo' ? 'DEMO DATA · synthetic' : 'REAL DATA · NASA LOLA + JPL DE421'}</div>
          <small>Karak &amp; Cosmos · NASA Space Apps 2026 prototype · not NASA-endorsed</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <h1>{PAGES.find(p => p.id === page)?.label}</h1>
          <div className="tb-items mono">
            <span>SITE <b>{site?.name ?? '—'}</b></span>
            <span>LANDING <b>{fmtDate(hourToDate(m.ds, m.startH))}</b></span>
            <span>DURATION <b>{m.durDays} d</b></span>
            <span>DISPLAY <b>{fmtDate(hourToDate(m.ds, m.hour))}</b></span>
          </div>
        </header>
        {m.ds.meta.mode === 'demo' && <div className="demo-banner">DEMO MODE — terrain and ephemeris are synthetic and illustrative only. Run <code>pipeline/build_open.py</code> to build the real NASA-derived datasets.</div>}
        <div className="content">
          {page === 'polemap' && <PoleMap />}
          {page === 'sky' && <SunEarth />}
          {page === 'compare' && <Compare />}
          {page === 'overview' && <Overview go={setPage} />}
          {page === 'explorer' && <Explorer />}
          {page === 'landing' && <Landing />}
          {page === 'planner' && <Planner />}
          {page === 'whatif' && <WhatIf />}
          {page === 'sources' && <Sources />}
        </div>
      </main>
    </div>
  );
}

const pickInitialRegion = (regions: RegionInfo[]) => {
  const q = new URLSearchParams(location.search).get('region');
  let saved: string | null = null; try { saved = localStorage.getItem('lunaris.region'); } catch { /* ignore */ }
  return regions.find(r => r.id === q)?.id ?? regions.find(r => r.id === saved)?.id ?? regions[0]?.id ?? '';
};

export default function App() {
  const [regions, setRegions] = useState<RegionInfo[] | null>(null);
  const [regionId, setRegionId] = useState('');
  const [ds, setDs] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sites, setSites] = useState<SiteRef[]>([]);
  const [shortlist, setShortlist] = useState<ShortItem[]>([]);
  const [pendingSite, setPendingSite] = useState<string | undefined>(undefined);
  const [page, setPageRaw] = useState(() => { const h = location.hash.slice(1); return PAGE_IDS.has(h) ? h : 'polemap'; });
  const setPage = (p: string) => { setPageRaw(p); try { history.replaceState(null, '', '#' + p); } catch { location.hash = p; } window.scrollTo?.(0, 0); };
  useEffect(() => { const f = () => { const h = location.hash.slice(1); if (PAGE_IDS.has(h)) setPageRaw(h); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => { loadRegions().then(r => { setRegions(r); setRegionId(pickInitialRegion(r)); allSites(r).then(all => {
    setSites(all);
    // default shortlist: each region's first (published / named) site for the three best-lit regions
    const best = [...r].sort((a, b) => b.siteSun - a.siteSun).slice(0, 3).map(x => all.find(s => s.regionId === x.id)).filter(Boolean) as SiteRef[];
    setShortlist(best.map(s => ({ regionId: s.regionId, siteId: s.siteId })));
  }); }); }, []);
  useEffect(() => {
    if (regions === null) return;
    setDs(null);
    try { if (regionId) localStorage.setItem('lunaris.region', regionId); } catch { /* ignore */ }
    (regionId ? getDataset(regionId) : loadDataset('./data/')).then(setDs).catch(e => setErr(String(e.message ?? e)));
  }, [regions, regionId]);
  const ws: Workspace = useMemo(() => ({
    regions: regions ?? [], regionId, sites, shortlist, setShortlist, page, go: setPage,
    openSite: (rid: string, sid: string, pg?: string) => { setPendingSite(sid); if (rid !== regionId) setRegionId(rid); else setPendingSite(sid + '#' + Date.now()); if (pg) setPage(pg); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [regions, regionId, sites, shortlist, page]);
  if (err) return <div className="boot err"><b>Could not load data</b><p>{err}</p></div>;
  if (!ds || regions === null) return <div className="boot"><div className="spinner" />Loading lunar dataset…</div>;
  const initSite = pendingSite?.split('#')[0];
  return <WsCtx.Provider value={ws}><MissionProvider key={(ds.meta.regionId ?? 'single') + (pendingSite ?? '')} ds={ds} initialSiteId={initSite}>
    <Shell regions={regions} regionId={regionId} setRegionId={setRegionId} page={page} setPage={setPage} /></MissionProvider></WsCtx.Provider>;
}
