"""Two analyses that are only valid on a harmonized record.

1) TRENDS: for every 1-degree cell, annual fire activity 2003-2025.
   Mann-Kendall test (tie-corrected) + Sen's slope, Benjamini-Hochberg FDR (q = 0.10) across cells.
   Run on the harmonized record AND on the raw FIRMS sum, to show how sensor changes fake trends.
2) FIRE REGIMES: unsupervised clustering (k-means on standardized features) of 1-degree cells by
   how they burn: 12-month seasonal profile, activity level, year-to-year variability, cropland
   share, night share. k chosen by silhouette score.
Output: web/data/trends.json, web/data/regimes.json
"""
import json
import warnings
warnings.filterwarnings("ignore")
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler
from common import WORK, WEB_DATA, GRID, cell_center

YEARS = list(range(2003, 2026))
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def mann_kendall(x):
    x = np.asarray(x, float); n = len(x)
    s = sum(np.sign(x[j] - x[i]) for i in range(n - 1) for j in range(i + 1, n))
    _, counts = np.unique(x, return_counts=True)
    var = (n * (n - 1) * (2 * n + 5) - sum(c * (c - 1) * (2 * c + 5) for c in counts)) / 18
    if var <= 0:
        return 0.0, 1.0
    z = (s - np.sign(s)) / np.sqrt(var)
    return float(z), float(2 * (1 - stats.norm.cdf(abs(z))))


def sens_slope(x):
    x = np.asarray(x, float); n = len(x)
    sl = [(x[j] - x[i]) / (j - i) for i in range(n - 1) for j in range(i + 1, n)]
    return float(np.median(sl))


def bh(p, q=0.10):
    p = np.asarray(p); n = len(p); order = np.argsort(p)
    thresh = q * (np.arange(1, n + 1) / n)
    passed = p[order] <= thresh
    k = np.max(np.nonzero(passed)[0]) + 1 if passed.any() else 0
    sig = np.zeros(n, bool); sig[order[:k]] = True
    return sig


def main():
    c = pd.read_pickle(WORK / "harmonized_cells.pkl")
    la, lo = cell_center(c["cell"].values, GRID)
    c["lat"], c["lon"] = np.floor(la) + .5, np.floor(lo) + .5
    c["year"] = 2000 + c["mi"] // 12; c["month"] = c["mi"] % 12 + 1
    c = c[c["year"].isin(YEARS)]
    ann_h = c.groupby(["lat", "lon", "year"])["h"].sum().unstack("year").reindex(columns=YEARS, fill_value=0).fillna(0)
    ann_r = c.groupby(["lat", "lon", "year"])["raw"].sum().unstack("year").reindex(columns=YEARS, fill_value=0).fillna(0)
    keep = ann_h.index[(ann_h.sum(1) >= 30) & ((ann_h > 0).sum(1) >= 8)]   # cells with a real fire history
    ann_h, ann_r = ann_h.loc[keep], ann_r.loc[keep]

    # ---------------- 1) trends
    rows = []
    for (a, b), hv in ann_h.iterrows():
        rv = ann_r.loc[(a, b)].values
        zh, ph = mann_kendall(hv.values); zr, pr = mann_kendall(rv)
        med_h, med_r = max(np.median(hv.values), 1e-6), max(np.median(rv), 1e-6)
        rows.append([a, b, zh, ph, sens_slope(hv.values) / med_h * 100, zr, pr, sens_slope(rv) / med_r * 100, float(hv.mean())])
    t = pd.DataFrame(rows, columns=["lat", "lon", "z_h", "p_h", "slope_h_pct", "z_r", "p_r", "slope_r_pct", "mean_h"])
    t["sig_h"], t["sig_r"] = bh(t["p_h"]), bh(t["p_r"])
    def summ(z, sig):
        return {"up": int(((z > 0) & sig).sum()), "down": int(((z < 0) & sig).sum()), "none": int((~sig).sum())}
    tr = {"years": [YEARS[0], YEARS[-1]], "test": "Mann-Kendall + Sen's slope, Benjamini-Hochberg FDR q=0.10, 1-degree cells",
          "harmonized": summ(t["z_h"], t["sig_h"]), "raw": summ(t["z_r"], t["sig_r"]),
          "cells": [[float(r.lat), float(r.lon), round(float(r.slope_h_pct), 1), int(r.sig_h) * int(np.sign(r.z_h)), round(float(r.slope_r_pct), 1), int(r.sig_r) * int(np.sign(r.z_r))] for r in t.itertuples()],
          "cols": ["lat", "lon", "sen_slope_pct_per_yr_harmonized", "sig_dir_harmonized", "sen_slope_pct_per_yr_raw", "sig_dir_raw"]}
    # national series trend
    nat_h = ann_h.sum(0).values; nat_r = ann_r.sum(0).values
    tr["national"] = {"harmonized": {"z": round(float(mann_kendall(nat_h)[0]), 2), "p": round(float(mann_kendall(nat_h)[1]), 4), "sen_pct_per_yr": round(float(sens_slope(nat_h) / np.median(nat_h) * 100), 2)},
                      "raw": {"z": round(float(mann_kendall(nat_r)[0]), 2), "p": round(float(mann_kendall(nat_r)[1]), 4), "sen_pct_per_yr": round(float(sens_slope(nat_r) / np.median(nat_r) * 100), 2)}}
    (WEB_DATA / "trends.json").write_text(json.dumps(tr, separators=(",", ":")))
    print("TRENDS harmonized", tr["harmonized"], "raw", tr["raw"]); print("national", tr["national"])

    # ---------------- 2) regimes
    mon = c.groupby(["lat", "lon", "month"])["h"].sum().unstack("month").reindex(columns=range(1, 13), fill_value=0).fillna(0).loc[keep]
    prof = mon.div(mon.sum(1), axis=0)
    lc_share = pd.Series(0.0, index=keep)
    try:
        lcd = pd.read_pickle(WORK / "harmonized_cells_lc.pkl")
        la2, lo2 = cell_center(lcd["cell"].values, GRID); lcd["lat"], lcd["lon"] = np.floor(la2) + .5, np.floor(lo2) + .5
        g = lcd.groupby(["lat", "lon", "lc"])["w"].sum().unstack("lc").fillna(0)
        lc_share = (g.get("cropland", 0) / g.sum(1)).reindex(keep).fillna(0)
    except FileNotFoundError:
        pass
    w = pd.read_pickle(WORK / "weights.pkl")
    w = w[w["w"] > 0]; w["lat1"], w["lon1"] = np.floor(w["lat"]) + .5, np.floor(w["lon"]) + .5
    night = (w.assign(n=w["dn"] * w["w"]).groupby(["lat1", "lon1"])[["n", "w"]].sum())
    night_share = (night["n"] / night["w"]).reindex(keep).fillna(0).values
    X = np.column_stack([prof.values * 3, np.log1p(ann_h.mean(1).values), (ann_h.std(1) / ann_h.mean(1).replace(0, np.nan)).fillna(0).values,
                         lc_share.values, night_share])
    Xs = StandardScaler().fit_transform(X)
    best = None
    for k in range(3, 8):
        km = KMeans(n_clusters=k, n_init=30, random_state=0).fit(Xs)
        if np.bincount(km.labels_).min() < 8:   # no tiny outlier clusters
            continue
        sc = silhouette_score(Xs, km.labels_)
        if best is None or sc > best[0]:
            best = (sc, k, km)
    sc, k, km = best
    lab = km.labels_
    clusters = []
    for j in range(k):
        m = lab == j
        p = prof.values[m].mean(0)
        peaks = [MONTHS[i] for i in np.argsort(-p)[:2]]
        crop = float(lc_share.values[m].mean())
        act = float(ann_h.mean(1).values[m].mean())
        trend_up = int(((t["z_h"].values[m] > 0) & t["sig_h"].values[m]).sum()); trend_dn = int(((t["z_h"].values[m] < 0) & t["sig_h"].values[m]).sum())
        top = sorted(np.argsort(-p)[:2])
        span = f"{MONTHS[top[0]]}–{MONTHS[top[1]]}" if abs(top[1] - top[0]) == 1 else f"{MONTHS[top[0]]} + {MONTHS[top[1]]}"
        kind = "cropland burning" if crop > .35 else "steppe & grassland fires" if crop < .15 else "mixed cropland & steppe"
        clusters.append({"id": j, "name": f"{kind.capitalize()}, peak {span}", "peaks": peaks, "profile": [round(float(x), 3) for x in p],
                         "cells": int(m.sum()), "cropland_share": round(crop, 2), "mean_annual_hotspots": round(act, 1),
                         "night_share": round(float(night_share[m].mean()), 3), "cells_trend_up": trend_up, "cells_trend_down": trend_dn})
    reg = {"method": f"k-means (k={k}, chosen by silhouette={sc:.2f}) on seasonal profile, activity, variability, cropland share, night share",
           "clusters": clusters, "cells": [[float(a), float(b), int(l)] for (a, b), l in zip(keep, lab)]}
    (WEB_DATA / "regimes.json").write_text(json.dumps(reg, separators=(",", ":")))
    print(reg["method"])
    for cl in clusters:
        print(cl["name"], cl["peaks"], cl["cells"], "crop", cl["cropland_share"], "act", cl["mean_annual_hotspots"], "up/down", cl["cells_trend_up"], cl["cells_trend_down"])


if __name__ == "__main__":
    main()
