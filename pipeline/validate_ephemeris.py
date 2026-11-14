"""Compare LUNARIS Sun/Earth directions with JPL Horizons (DE441, MEAN_ME) at the IM-2 landing site.

Reference tables: pipeline/validation/jpl_horizons/{sun,earth}_im2.txt (JPL Horizons API output,
site 84.7906 S, 29.1957 E, 0 km, hourly 2026-11-01 .. 2027-11-01).
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lunaris.ephem import body_vectors, topo_azel  # noqa: E402

HERE = Path(__file__).resolve().parent
REF = HERE / "validation" / "jpl_horizons"


def read_horizons(p):
    rows, on = [], False
    for line in p.read_text().splitlines():
        if line.startswith("$$SOE"): on = True; continue
        if line.startswith("$$EOE"): break
        if on:
            f = [x.strip() for x in line.split(",")]
            rows.append((float(f[3]), float(f[4])))
    return np.array(rows)


def main():
    sun_ref, earth_ref = read_horizons(REF / "sun_im2.txt"), read_horizons(REF / "earth_im2.txt")
    n = len(sun_ref)
    _, sun, earth = body_vectors("2026-11-01T00", n)
    res = {}
    for name, vec, ref in (("sun", sun, sun_ref), ("earth", earth, earth_ref)):
        az, el = topo_azel(vec, -84.7906, 29.1957)
        daz = (az - ref[:, 0] + 180) % 360 - 180
        dang = np.hypot(daz * np.cos(np.radians(ref[:, 1])), el - ref[:, 1])   # great-circle approx
        res[name] = {"samples": int(n), "max_elev_error_deg": round(float(np.abs(el - ref[:, 1]).max()), 4),
                     "rms_elev_error_deg": round(float(np.sqrt(np.mean((el - ref[:, 1]) ** 2))), 4),
                     "max_direction_error_deg": round(float(dang.max()), 4),
                     "rms_direction_error_deg": round(float(np.sqrt(np.mean(dang ** 2))), 4)}
    res["reference"] = "JPL Horizons API (DE441), IM-2 site 84.7906 S 29.1957 E, hourly 2026-11-01..2027-11-01"
    res["criterion"] = "direction error < 0.05 deg (one fifth of the solar disc radius)"
    res["pass"] = all(res[k]["max_direction_error_deg"] < 0.05 for k in ("sun", "earth"))
    out = HERE / "validation" / "ephemeris_vs_horizons.json"
    out.write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))
    return 0 if res["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
