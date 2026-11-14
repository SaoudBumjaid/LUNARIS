"""Check LUNARIS sunlight at Connecting Ridge (RoI 4) against Barker et al. (2021).

Reference: Barker, M.K. et al. (2021) Planet. Space Sci. 203, 105119, Table 2, Site 1 RoI 4:
average solar visibility 88.12 % (5 m above ground) and 69.61 % (1 m, 1st-percentile value 'A'),
period 2024-01-01 .. 2026-01-01; longest continuous shadow (99th pct) about 4.0 days at 5 m.
Pass criteria were fixed BEFORE running: 5 m average within 83-93 % (+-5 points of 88.1 %),
longest continuous shadow <= 6 days.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_open import TP, PATCH_STEP, load_far_dem, load_patch, far_horizon, point_horizon  # noqa: E402
from lunaris import core  # noqa: E402
from lunaris.ephem import body_vectors, topo_azel  # noqa: E402


def longest_run(mask):
    best = cur = 0
    for v in mask:
        cur = cur + 1 if v else 0
        best = max(best, cur)
    return best


def main():
    site = next(s for s in json.loads((TP / "lunar_ops" / "sites.json").read_text())["sites"] if s["id"] == "connecting-ridge-roi4")
    z, px, half = load_far_dem()
    Ep = load_patch(site)
    _, sun, _ = body_vectors("2024-01-01T00", 2 * 365 * 24 + 24)
    res = {"site": site["name"], "period": "2024-01-01..2026-01-01", "reference": "Barker et al. 2021, PSS 203:105119, Table 2"}
    for zm in (5.0, 1.0):
        near = point_horizon(Ep, PATCH_STEP, 200, 200, zm, naz=1440)
        far, _ = far_horizon(z, px, half, site["lat"], site["lon"], site["h_site_m"] + zm, naz=1440)
        hz = np.maximum(near, far)
        az, el = topo_azel(sun, site["lat"], site["lon"], site["h_site_m"] + zm)
        h = core.interp_horizon(hz, az)
        frac = np.clip((el - h) / (2 * core.SUN_RADIUS_DEG) + 0.5, 0, 1)
        res[f"z{int(zm)}m"] = {"avg_visible_sun_pct": round(float(frac.mean() * 100), 2),
                               "longest_shadow_days": round(longest_run(frac <= 0) / 24, 2)}
    res["published"] = {"z5m_avg_pct": 88.12, "z5m_longest_shadow_days": 4.0, "z1m_avg_pct": 69.61}
    res["criteria"] = "z5m average 83-93 %, z5m longest shadow <= 6 days (fixed before running)"
    a5 = res["z5m"]["avg_visible_sun_pct"]
    res["pass"] = (83 <= a5 <= 93) and res["z5m"]["longest_shadow_days"] <= 6
    (Path(__file__).resolve().parent / "validation" / "illumination_vs_barker2021.json").write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))
    return 0 if res["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
