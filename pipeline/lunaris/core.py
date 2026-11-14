"""
LUNARIS pipeline core — terrain & illumination geometry shared by the demo and
real-data builders.

Conventions (used identically by the web app):
  * Grid is south-polar stereographic, sphere R = 1737.4 km, lon_0 = 0:
        x = rho * sin(lon),  y = rho * cos(lon),  rho = 2R tan((90 + lat)/2)
  * Raster row 0 is the NORTH-most row (max y); col 0 is the WEST-most (min x).
  * "Grid azimuth" is measured from grid +y toward grid +x (degrees, 0..360).
  * Horizon masks are stored for NAZ azimuth bins, bin b centred on b*360/NAZ.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from scipy import ndimage

R_MOON = 1737400.0
NAZ = 72                      # 5-degree azimuth bins
HZ_SCALE = 5.0                # horizon uint8 = (deg + HZ_OFFSET) * HZ_SCALE
HZ_OFFSET = 10.0              # encodes -10 .. +41 deg
SUN_RADIUS_DEG = 0.2666


# --------------------------------------------------------------------------- projection
def latlon_to_xy(lat, lon):
    lat = np.radians(lat); lon = np.radians(lon)
    rho = 2 * R_MOON * np.tan((np.pi / 2 + lat) / 2)
    return rho * np.sin(lon), rho * np.cos(lon)


def xy_to_latlon(x, y):
    rho = np.hypot(x, y)
    lat = 2 * np.arctan(rho / (2 * R_MOON)) - np.pi / 2
    lon = np.arctan2(x, y)
    return np.degrees(lat), np.degrees(lon)


def latlon_to_vec(lat, lon, r=R_MOON):
    lat = np.radians(lat); lon = np.radians(lon)
    return r * np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])


def grid_basis(xc, yc, d=50.0):
    """3-D unit vectors (Moon body-fixed ME frame) of grid +x, grid +y and local up at (xc, yc)."""
    p0 = latlon_to_vec(*xy_to_latlon(xc, yc))
    px = latlon_to_vec(*xy_to_latlon(xc + d, yc))
    py = latlon_to_vec(*xy_to_latlon(xc, yc + d))
    up = p0 / np.linalg.norm(p0)
    ex = px - p0; ex -= ex.dot(up) * up; ex /= np.linalg.norm(ex)
    ey = py - p0; ey -= ey.dot(up) * up; ey -= ey.dot(ex) * ex; ey /= np.linalg.norm(ey)
    return ex, ey, up, p0


def body_dir_to_azel(vecs, ex, ey, up):
    """vecs: (T,3) observer->body vectors in ME frame. Returns grid azimuth & elevation (deg)."""
    v = vecs / np.linalg.norm(vecs, axis=1, keepdims=True)
    e = v @ up
    gx = v @ ex
    gy = v @ ey
    az = (np.degrees(np.arctan2(gx, gy)) + 360) % 360
    el = np.degrees(np.arcsin(np.clip(e, -1, 1)))
    return az, el


# --------------------------------------------------------------------------- terrain
def slope_deg(E, cell):
    gy, gx = np.gradient(E, cell)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def roughness(E, cell):
    """Std-dev (m) of residual after removing a local 3x3 mean — a simple roughness proxy."""
    mean = ndimage.uniform_filter(E, 3, mode="nearest")
    res = E - mean
    return np.sqrt(ndimage.uniform_filter(res ** 2, 3, mode="nearest"))


def horizon_masks(E, cell, h0=2.0, naz=NAZ, max_dist=None):
    """Terrain-aware horizon elevation (deg) for every cell and azimuth bin.

    Ray-marching with geometrically growing steps; includes lunar curvature drop d^2/2R.
    Limited to terrain inside the grid — merge with far_horizon() for distant terrain.
    """
    H, W = E.shape
    rows, cols = np.mgrid[0:H, 0:W].astype(np.float32)
    obs = E + h0
    if max_dist is None:
        max_dist = math.hypot(H, W) * cell
    steps, k = [], 1.0
    while k * cell <= max_dist:
        steps.append(k)
        k += max(1.0, k * 0.06)
    out = np.full((H, W, naz), -10.0, dtype=np.float32)
    for b in range(naz):
        a = math.radians(b * 360.0 / naz)
        dc, dr = math.sin(a), -math.cos(a)
        best = np.full((H, W), -90.0, dtype=np.float32)
        for k in steps:
            rr = rows + dr * k
            cc = cols + dc * k
            z = ndimage.map_coordinates(E, [rr, cc], order=1, mode="constant", cval=np.nan)
            d = k * cell
            ang = np.degrees(np.arctan((z - obs - d * d / (2 * R_MOON)) / d))
            np.fmax(best, np.nan_to_num(ang, nan=-90.0), out=best)
        out[:, :, b] = best
        if (b + 1) % 12 == 0: print(f"  horizon azimuth {b + 1}/{naz}")
    return out


def far_horizon_from_dem(E, cell, r0, c0, h_obs, start_dist, naz=NAZ):
    """Horizon (deg) seen from a single point (r0, c0) of a large/coarse DEM, ignoring terrain nearer than start_dist."""
    H, W = E.shape
    out = np.full(naz, -10.0)
    dist = np.full(naz, start_dist)
    for b in range(naz):
        a = math.radians(b * 360.0 / naz)
        dc, dr = math.sin(a), -math.cos(a)
        best = -90.0
        d = start_dist
        while True:
            r = r0 + dr * d / cell; c = c0 + dc * d / cell
            if r < 0 or c < 0 or r > H - 1 or c > W - 1:
                break
            z = ndimage.map_coordinates(E, [[r], [c]], order=1)[0]
            ang = math.degrees(math.atan((z - h_obs - d * d / (2 * R_MOON)) / d))
            if ang > best:
                best, dist[b] = ang, d
            d += max(cell, d * 0.01)
        out[b] = best
    return out, dist


def merge_far_horizon(hz, far_deg, far_dist, E, e_ref):
    """Combine near (in-grid) horizons with a distant horizon measured from elevation e_ref.

    The distant horizon angle is re-referenced to each cell's own height:
        a_cell = atan(tan(a_ref) - (E_cell - e_ref) / d)
    so that high peaks correctly look *over* distant terrain.
    """
    t = np.tan(np.radians(far_deg))[None, None, :] - (E - e_ref)[:, :, None] / far_dist[None, None, :]
    return np.maximum(hz, np.degrees(np.arctan(t)).astype(np.float32))


def interp_horizon(hz, az):
    """hz: (..., NAZ) horizon; az: scalar or (...) azimuths (deg). Linear interpolation between bins."""
    naz = hz.shape[-1]
    f = (np.asarray(az) % 360) / (360.0 / naz)
    i0 = np.floor(f).astype(int) % naz
    i1 = (i0 + 1) % naz
    w = f - np.floor(f)
    return np.take(hz, i0, axis=-1) * (1 - w) + np.take(hz, i1, axis=-1) * w


def el_offsets(dx, dy, az):
    """Per-cell elevation correction (deg) for a body at grid azimuth az, cell offset (dx,dy) m from centre."""
    a = np.radians(az)
    return np.degrees((dx * np.sin(a) + dy * np.cos(a)) / R_MOON)


def annual_stats(hz, dxy, sun_az, sun_el, earth_az, earth_el, stride=4):
    """Fraction of time sunlit (mean visible solar-disc fraction) and Earth-visible, per cell."""
    dx, dy = dxy
    N = hz.shape[0]
    sun = np.zeros(N, np.float64); earth = np.zeros(N, np.float64)
    idx = range(0, len(sun_az), stride)
    for t in idx:
        h = interp_horizon(hz, sun_az[t])
        el = sun_el[t] + el_offsets(dx, dy, sun_az[t])
        sun += np.clip((el - h) / (2 * SUN_RADIUS_DEG) + 0.5, 0, 1)
        h = interp_horizon(hz, earth_az[t])
        el = earth_el[t] + el_offsets(dx, dy, earth_az[t])
        earth += (el > h)
    n = len(idx)
    return sun / n, earth / n


def psr_mask(hz, dxy, sun_az, sun_el):
    """Cells where the top of the solar disc never clears the terrain horizon over the ephemeris span."""
    dx, dy = dxy
    naz = hz.shape[1]
    bins = np.round(sun_az / (360 / naz)).astype(int) % naz
    lit = np.zeros(hz.shape[0], bool)
    for b in range(naz):
        sel = bins == b
        if not sel.any():
            continue
        top = sun_el[sel].max() + SUN_RADIUS_DEG
        az_b = b * 360 / naz
        lit |= (top + el_offsets(dx, dy, az_b)) > hz[:, b]
    return ~lit


def science_targets(psr2d, cell, slope=None, sun2d=None, max_n=5, min_cells=6, trav_slope=15.0, reach_m=800.0):
    lab, n = ndimage.label(psr2d)
    if n == 0:
        return []
    sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    order = np.argsort(sizes)[::-1]
    targets = []
    edge = psr2d & ~ndimage.binary_erosion(psr2d)
    for rank, i in enumerate(order[:max_n]):
        if sizes[i] < min_cells:
            break
        comp = lab == (i + 1)
        rr, cc = np.nonzero(comp)
        r0, c0 = rr.mean(), cc.mean()
        er, ec = np.nonzero(comp & edge)
        j = np.argmin((er - r0) ** 2 + (ec - c0) ** 2) if len(er) else 0
        # Rover approach point: traversable (slope < trav_slope), sunlit-side cell within reach_m
        # of the PSR, in the largest traversable component; nearest to the PSR edge.
        dist_c = ndimage.distance_transform_edt(~comp) * cell
        cand = (~psr2d) & (dist_c <= reach_m)
        if slope is not None:
            tlab, _ = ndimage.label(slope < trav_slope)
            sizes_t = np.bincount(tlab.ravel()); sizes_t[0] = 0
            cand &= tlab == np.argmax(sizes_t)
        rr2, cc2 = np.nonzero(cand)
        if len(rr2) == 0:
            continue
        if sun2d is not None:
            lit = sun2d[rr2, cc2]
            good = lit >= 0.2
            if good.any():
                rr2, cc2 = rr2[good], cc2[good]
                k = np.argmin(dist_c[rr2, cc2])
            else:
                k = np.argmax(lit)
        else:
            k = np.argmin(dist_c[rr2, cc2])
        targets.append({
            "id": f"PSR-{len(targets) + 1}",
            "areaKm2": round(float(sizes[i]) * cell * cell / 1e6, 3),
            "centroid": [int(round(r0)), int(round(c0))],
            "edgeCell": [int(rr2[k]), int(cc2[k])],
            "status": "inferred",
            "approachDistM": round(float(dist_c[rr2[k], cc2[k]]), 1),
            "note": "Permanently shadowed per LUNARIS horizon computation. Potential cold trap — NOT an observed ice detection. edgeCell = nearest rover-traversable approach point.",
        })
    return targets


def suggest_sites(slope, sun, earth, psr2d, cell, max_slope=10.0, n=3, min_sep_m=1500, ellipse_m=150.0):
    H, W = slope.shape
    dist_psr = ndimage.distance_transform_edt(~psr2d) * cell if psr2d.any() else np.full_like(slope, 1e5)
    smooth_slope = ndimage.maximum_filter(slope, 2 * int(math.ceil(ellipse_m / cell)) + 1)
    ok = (smooth_slope < max_slope) & ~psr2d
    score = 0.5 * sun + 0.3 * earth + 0.2 * np.clip(1 - dist_psr / 5000, 0, 1)
    score = np.where(ok, score, -1)
    picks = []
    flat = np.argsort(score.ravel())[::-1]
    for idx in flat:
        if score.ravel()[idx] < 0:
            break
        r, c = divmod(int(idx), W)
        if r < 12 or c < 12 or r > H - 13 or c > W - 13:
            continue
        if all(math.hypot(r - p[0], c - p[1]) * cell > min_sep_m for p in picks):
            picks.append((r, c))
        if len(picks) == n:
            break
    names = "ABCDEFG"
    return [{"id": f"auto-{names[i]}", "name": f"Auto-candidate {names[i]}", "cell": [r, c],
             "origin": "auto-suggested by LUNARIS (max slope < %g° within %g m, high Sun/Earth)" % (max_slope, ellipse_m)}
            for i, (r, c) in enumerate(picks)]


# --------------------------------------------------------------------------- export
def export(out_dir: Path, *, E, cell, x0, y0, hz, slope, rough, sun, earth, psr2d,
           ephem, sites, targets, meta_extra):
    out_dir.mkdir(parents=True, exist_ok=True)
    H, W = E.shape
    E.astype("<f4").tofile(out_dir / "elevation.bin")
    slope.astype("<f4").tofile(out_dir / "slope.bin")
    rough.astype("<f4").tofile(out_dir / "rough.bin")
    np.clip(np.round((hz + HZ_OFFSET) * HZ_SCALE), 0, 255).astype("u1").tofile(out_dir / "horizon.bin")
    np.round(sun.reshape(H, W) * 200).astype("u1").tofile(out_dir / "sun_annual.bin")
    np.round(earth.reshape(H, W) * 200).astype("u1").tofile(out_dir / "earth_annual.bin")
    psr2d.astype("u1").tofile(out_dir / "psr.bin")
    (out_dir / "ephem.json").write_text(json.dumps(ephem))
    meta = {
        "width": W, "height": H, "cellSize": cell, "x0": x0, "y0": y0,
        "projection": "+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m",
        "naz": hz.shape[-1], "hzScale": HZ_SCALE, "hzOffset": HZ_OFFSET, "sunRadiusDeg": SUN_RADIUS_DEG,
        "R": R_MOON, "sites": sites, "targets": targets,
        "files": {"elevation": "elevation.bin", "slope": "slope.bin", "rough": "rough.bin",
                  "horizon": "horizon.bin", "sunAnnual": "sun_annual.bin",
                  "earthAnnual": "earth_annual.bin", "psr": "psr.bin", "ephem": "ephem.json"},
    }
    meta.update(meta_extra)
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"Dataset written to {out_dir}  ({W}x{H} cells @ {cell} m)")
