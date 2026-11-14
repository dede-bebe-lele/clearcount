"""Group hotspots into fire events ("fires detected") so a current fire can be
compared with previous ones. Space-time connected components on the harmonized
record (points with weight > 0): two detections are linked if they fall in
neighbouring ~2 km cells on the same or the next day.

Event size is expressed in harmonized hotspots (sum of weights), so events from the
MODIS era and the VIIRS era are on the same scale.
Output: data/work/events.pkl
"""
import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from common import WORK

LINK = 0.02  # degrees (~2 km)


def main():
    p = pd.read_pickle(WORK / "weights.pkl")
    p = p[p["w"] > 0].reset_index(drop=True)
    i = np.floor((p["lat"].values + 90) / LINK).astype(np.int64)
    j = np.floor((p["lon"].values + 180) / LINK).astype(np.int64)
    d = (p["date"].values.astype("datetime64[D]").astype(np.int64))
    keys = pd.DataFrame({"i": i, "j": j, "d": d})
    uk = keys.drop_duplicates().reset_index(drop=True)
    uk["k"] = np.arange(len(uk))
    keys = keys.merge(uk, on=["i", "j", "d"], how="left")
    rows, cols = [], []
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            for dd in (0, 1):
                if di == dj == dd == 0:
                    continue
                s = uk[["i", "j", "d", "k"]].copy()
                s["i"] += di; s["j"] += dj; s["d"] += dd
                m = s.merge(uk, on=["i", "j", "d"], suffixes=("_a", "_b"))
                rows.append(m["k_a"].values); cols.append(m["k_b"].values)
    r, c = np.concatenate(rows), np.concatenate(cols)
    n = len(uk)
    g = coo_matrix((np.ones(len(r), dtype=np.int8), (r, c)), shape=(n, n))
    ncomp, lab = connected_components(g, directed=False)
    p["event"] = lab[keys["k"].values]
    ev = p.groupby("event").agg(
        start=("date", "min"), end=("date", "max"), n=("w", "size"), h=("w", "sum"),
        frp_max=("frp", "max"), lat=("lat", "mean"), lon=("lon", "mean"),
        lat0=("lat", "min"), lat1=("lat", "max"), lon0=("lon", "min"), lon1=("lon", "max"))
    ev["days"] = ((ev["end"] - ev["start"]).dt.days + 1).astype(int)
    ev = ev.sort_values("h", ascending=False).reset_index(drop=True)
    ev.to_pickle(WORK / "events.pkl")
    print(f"events: {len(ev):,}; with >=5 detections: {(ev['n'] >= 5).sum():,}")
    print(ev.head(10).round(2).to_string())


if __name__ == "__main__":
    main()
