"""Export compact static data for the ClearCount web app (web/data/)."""
import json
import math
import numpy as np
import pandas as pd
from common import WORK, WEB_DATA, GRID, cell_center, month_index, load_points

M0 = month_index(2000, 11)  # first month of the record (Terra start)
TILE = 5.0                  # point tiles for CSV export (degrees)


def r2(x):
    return float(round(float(x), 2))


def export_cells():
    c = pd.read_pickle(WORK / "harmonized_cells.pkl")
    lat, lon = cell_center(c["cell"].values, GRID)
    c["lat"], c["lon"] = lat.round(3), lon.round(3)
    cells = []
    for (cid, la, lo), g in c.groupby(["cell", "lat", "lon"]):
        cells.append([float(la), float(lo), (g["mi"].values - M0).tolist(),
                      [r2(x) for x in g["h"].values], g["raw"].astype(int).tolist()])
    m1 = int(c["mi"].max())
    meta = {"grid": GRID, "m0": int(M0), "n_months": int(m1 - M0 + 1), "start": "2000-11",
            "end": f"{2000 + m1 // 12}-{m1 % 12 + 1:02d}", "unit": "MODIS-Aqua-equivalent hotspots"}
    (WEB_DATA / "cells.json").write_text(json.dumps({"meta": meta, "cells": cells}, separators=(",", ":")))
    print("cells", len(cells), meta)
    return meta


def export_blind(meta):
    b = pd.read_pickle(WORK / "blind_1deg.pkl")
    b = b[b["mi"] >= M0]
    n = meta["n_months"]
    out = []
    for (la, lo), g in b.groupby(["lat", "lon"]):
        frac = np.full(n, -1.0)
        idx = g["mi"].values - M0
        ok = (idx >= 0) & (idx < n)
        frac[idx[ok]] = (g["blind_days"].values / g["days"].values)[ok]
        out.append([float(la), float(lo), [round(float(x), 2) for x in frac]])
    (WEB_DATA / "blind.json").write_text(json.dumps({"res": 1.0, "threshold_pct": 70, "cells": out}, separators=(",", ":")))
    print("blind cells", len(out))


def export_national():
    nat = pd.read_csv(WORK / "national.csv", index_col=0)
    nat.index = nat.index - M0
    cols = ["raw_all", "Terra", "Aqua", "N", "N20", "N21", "harmonized", "harmonized_n20chain"]
    js = {k: [r2(x) for x in nat[k].values] for k in cols}
    (WEB_DATA / "national.json").write_text(json.dumps(js, separators=(",", ":")))


def export_events():
    ev = pd.read_pickle(WORK / "events.pkl")
    ev = ev[ev["h"] >= 3.0]  # at least 3 MODIS-Aqua-equivalent hotspots
    rows = [[str(s.date()), str(e.date()), int(n), r2(h), r2(f), round(float(la), 3), round(float(lo), 3), int(d)]
            for s, e, n, h, f, la, lo, d in ev[["start", "end", "n", "h", "frp_max", "lat", "lon", "days"]].itertuples(index=False)]
    (WEB_DATA / "events.json").write_text(json.dumps({"cols": ["start", "end", "n", "h", "frp_max", "lat", "lon", "days"], "rows": rows}, separators=(",", ":")))
    print("events exported", len(rows))


def export_points():
    """All detections (incl. flagged flares) in 5-degree x year CSV tiles for CSV export."""
    p = load_points()
    w = pd.read_pickle(WORK / "weights.pkl")
    p["w"] = 0.0
    key_cols = ["lat", "lon", "date", "hhmm", "sat"]
    p = p.merge(w[key_cols + ["w"]].drop_duplicates(key_cols), on=key_cols, how="left", suffixes=("_x", ""))
    p["w"] = p["w"].fillna(0)
    p["class"] = np.where(p["type"] == 1, "volcano", np.where(p["type"] == 3, "offshore",
                 np.where(p["flare"] | (p["type"] == 2), "persistent_industrial", "landscape_fire")))
    p["tile"] = (np.floor(p["lat"] / TILE) * TILE).astype(int).astype(str) + "_" + (np.floor(p["lon"] / TILE) * TILE).astype(int).astype(str)
    outdir = WEB_DATA / "points"
    outdir.mkdir(exist_ok=True)
    index = {}
    for (tile, year), g in p.groupby(["tile", "year"]):
        f = outdir / f"{tile}_{year}.csv"
        g2 = pd.DataFrame({
            "latitude": g["lat"].round(4), "longitude": g["lon"].round(4),
            "acq_date": g["date"].astype(str), "acq_time_utc": g["hhmm"].astype(str).str.zfill(4),
            "satellite": g["sat"].astype(str), "frp_mw": g["frp"].round(1), "confidence": g["conf"],
            "daynight": np.where(g["dn"] == 1, "N", "D"), "firms_type": g["type"], "class": g["class"],
            "harmonized_weight": g["w"].round(3)})
        g2.to_csv(f, index=False)
        index.setdefault(tile, []).append(int(year))
    (WEB_DATA / "points_index.json").write_text(json.dumps({"tile": TILE, "tiles": index}))
    print("point tiles", sum(len(v) for v in index.values()))


def export_flares():
    f = pd.read_csv(WORK / "flare_cells.csv")
    f = f.sort_values("detections", ascending=False)
    (WEB_DATA / "flares.json").write_text(json.dumps(f.values.tolist(), separators=(",", ":")))


def main():
    meta = export_cells()
    export_blind(meta)
    export_national()
    export_events()
    export_flares()
    v = json.loads((WORK / "validation.json").read_text())
    v["meta"] = meta
    pts = load_points()
    v["counts_all"] = int(len(pts))
    v["flare_share"] = round(float((pts["flare"] | (pts["type"] != 0)).mean()), 4)
    del pts
    if (WORK / "looks_summary.json").exists():
        v["looks"] = json.loads((WORK / "looks_summary.json").read_text())
    (WEB_DATA / "validation.json").write_text(json.dumps(v, indent=1))
    export_points()
    export_daily_cloud()



def export_daily_cloud():
    """Per-year daily cloud amount (%) on the 1-degree POWER grid, for the day-by-day view."""
    d = pd.read_pickle(WORK / "cloud_daily.pkl")
    outdir = WEB_DATA / "cloud"
    outdir.mkdir(exist_ok=True)
    cells = d[["LAT", "LON"]].drop_duplicates().sort_values(["LAT", "LON"]).values.tolist()
    key = {tuple(c): k for k, c in enumerate(cells)}
    for y, g in d.groupby("YEAR"):
        ndays = int(g["DOY"].max())
        arr = np.full((len(cells), ndays), -1, dtype=int)
        ci = [key[(a, b)] for a, b in zip(g["LAT"].values, g["LON"].values)]
        arr[ci, g["DOY"].values - 1] = np.round(g["CLOUD_AMT"].values).astype(int)
        (outdir / f"{int(y)}.json").write_text(json.dumps({"cells": cells, "v": arr.tolist()}, separators=(",", ":")))
    print("daily cloud years", d["YEAR"].nunique())


if __name__ == "__main__":
    main()
