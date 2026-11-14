// App-wide state that outlives a region switch: regions, all candidate sites, the comparison shortlist, navigation.
import { createContext, useContext } from 'react';
import type { RegionInfo } from './engine/dataset';
import type { SiteRef } from './engine/sky';

export interface ShortItem { regionId: string; siteId: string }
export interface Workspace {
  regions: RegionInfo[]; regionId: string; sites: SiteRef[];
  shortlist: ShortItem[]; setShortlist: (s: ShortItem[]) => void;
  page: string; go: (page: string) => void;
  /** Switch region (if needed), select a site and open a page. */
  openSite: (regionId: string, siteId: string, page?: string) => void;
}
export const WsCtx = createContext<Workspace | null>(null);
export const useWorkspace = () => { const w = useContext(WsCtx); if (!w) throw new Error('no workspace'); return w; };
export const sameItem = (a: ShortItem, b: ShortItem) => a.regionId === b.regionId && a.siteId === b.siteId;
