"""Use satellite looks (FIRMS swath outlines via CMR):
1) decompose the VIIRS/MODIS detection ratio into  (looks ratio) x (detections per look ratio)
2) export daily looks per 1-degree cell for the web day-by-day view.
"""
import json
import numpy as np
import pandas as pd
from common import WORK, WEB_DATA, load_points


def main():
    z = np.load(WORK / "looks.npz")
    L, lat, lon, sats = z["L"], z["lat"], z["lon"], list(z["sats"])
    day0 = np.datetime64(str(z["day0"]))
    ndays = L.shape[2]
    dates = day0 + np.arange(ndays)

    # ---- 1) decomposition over the clean overlap 2012-2021, daytime, all Kazakhstan cells
    p = load_points()
    p = p[p["keep"] & (p["dn"] == 0) & p["year"].between(2012, 2021)]
    det = p["sat"].astype(str).value_counts()
    yrs = (dates >= np.datetime64("2012-01-20")) & (dates < np.datetime64("2022-01-01"))
    looks_day = {s: float(L[sats.index(s), 0][yrs].sum()) for s in ["Aqua", "N"]}
    looks_ratio = looks_day["N"] / looks_day["Aqua"]
    det_ratio = det["N"] / det["Aqua"]
    out = {"period": "2012-2021, daytime, Kazakhstan 1-degree cells",
           "detections_ratio_snpp_over_aqua": round(float(det_ratio), 2),
           "looks_ratio_snpp_over_aqua": round(looks_ratio, 2),
           "per_look_sensitivity_ratio": round(float(det_ratio / looks_ratio), 2),
           "mean_day_looks_per_cell_day": {s: round(float(L[sats.index(s), 0][yrs].mean()), 2) for s in ["Aqua", "N"]},
           "note": "detections ratio = looks ratio x per-look sensitivity ratio"}
    # yearly mean daytime looks per cell-day for each satellite (constellation growth)
    yearly = {}
    for s in sats:
        si = sats.index(s)
        ser = pd.Series(L[si, 0].mean(1), index=pd.DatetimeIndex(dates)).groupby(lambda d: d.year).mean()
        yearly[s] = {int(k): round(float(v), 2) for k, v in ser.items() if v > 0}
    out["yearly_day_looks"] = yearly
    v = json.loads((WEB_DATA / "validation.json").read_text())
    v["looks"] = out
    (WORK / "looks_summary.json").write_text(json.dumps(out))
    (WEB_DATA / "validation.json").write_text(json.dumps(v, indent=1))
    print(json.dumps({k: out[k] for k in out if k != "yearly_day_looks"}, indent=1))

    # ---- 2) daily looks per cell per year for the web (sum of day+night passes)
    outdir = WEB_DATA / "looks"
    outdir.mkdir(exist_ok=True)
    tot = L.sum(1)  # sat, day, cell
    years = pd.DatetimeIndex(dates).year
    for y in range(2000, __import__('datetime').date.today().year + 1):
        sel = years == y
        js = {"cells": [[float(a), float(b)] for a, b in zip(lat, lon)], "sats": sats,
              "v": [tot[si][sel].T.astype(int).tolist() for si in range(len(sats))]}
        (outdir / f"{y}.json").write_text(json.dumps(js, separators=(",", ":")))
    print("exported daily looks", (outdir).as_posix())


if __name__ == "__main__":
    main()
