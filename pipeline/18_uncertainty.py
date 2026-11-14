"""Calibration uncertainty of the harmonized record (bootstrap over days).

The harmonized count of a month is a sum of sensor detections times ratios k (by day/night
and season). Resampling the calibration days with replacement (1000 times) gives a
distribution of each k; re-weighting every month's detections with each bootstrap k set
gives a 95% interval for the monthly harmonized count. Ratios are national here, so the
interval reflects calibration uncertainty, not sampling noise of the fires themselves.
Output: web/data/uncertainty.json  {m0, lo:[...], hi:[...]} relative factors per month
"""
import json
import numpy as np
import pandas as pd
from common import WORK, WEB_DATA, season_of, month_index

B = 1000
rng = np.random.default_rng(7)
M0 = month_index(2000, 11)


def boot_ratio(p, num, den, years):
    """Bootstrap k = num/den by (dn, season), resampling calendar days."""
    q = p[p["sat"].isin([num, den]) & p["year"].between(*years)]
    daily = q.groupby(["date", "sat", "dn", "season"]).size().unstack("sat", fill_value=0)
    for s in (num, den):
        if s not in daily:
            daily[s] = 0
    days = daily.index.get_level_values("date").unique()
    keys = sorted(set(zip(daily.index.get_level_values("dn"), daily.index.get_level_values("season"))))
    # matrix: day x group, counts for num and den
    A = np.zeros((len(days), len(keys))); D = np.zeros_like(A)
    di = {d: i for i, d in enumerate(days)}; gi = {k: j for j, k in enumerate(keys)}
    for (d, dn, se), r in daily.iterrows():
        A[di[d], gi[(dn, se)]] += r[num]; D[di[d], gi[(dn, se)]] += r[den]
    k0 = A.sum(0) / np.maximum(D.sum(0), 1)
    idx = rng.integers(0, len(days), size=(B, len(days)))
    kb = A[idx].sum(1) / np.maximum(D[idx].sum(1), 1)          # B x groups
    return keys, k0, kb


def main():
    p = pd.read_pickle(WORK / "points.pkl")
    p = p[p["keep"]].copy()
    p["sat"] = p["sat"].astype(str); p["season"] = season_of(p["month"])
    p["mi"] = (p["year"] - 2000) * 12 + p["month"] - 1
    w = pd.read_pickle(WORK / "weights.pkl")[["lat", "lon", "date", "hhmm", "sat", "w", "mi"]]
    w["sat"] = w["sat"].astype(str)
    w = w.merge(p[["lat", "lon", "date", "hhmm", "sat", "dn", "season"]].drop_duplicates(["lat", "lon", "date", "hhmm", "sat"]),
                on=["lat", "lon", "date", "hhmm", "sat"], how="left")
    w = w[w["w"] > 0]
    nmon = int(w["mi"].max()) + 1
    total = np.zeros(nmon); np.add.at(total, w["mi"].values, w["w"].values)
    samples = np.repeat(total[None, :], B, axis=0)
    for sats, num, den, yrs in ((["N"], "Aqua", "N", (2012, 2021)), (["Terra"], "Aqua", "Terra", (2003, 2011)), (["N20"], "N", "N20", (2018, 2025))):
        keys, k0, kb = boot_ratio(p, num, den, yrs)
        rel = kb / k0                                            # B x groups, relative multiplier
        sub = w[w["sat"].isin(sats)]
        for j, (dn, se) in enumerate(keys):
            g = sub[(sub["dn"] == dn) & (sub["season"] == se)]
            contrib = np.zeros(nmon); np.add.at(contrib, g["mi"].values, g["w"].values)
            samples += (rel[:, j][:, None] - 1) * contrib[None, :]
    lo = np.percentile(samples, 2.5, axis=0); hi = np.percentile(samples, 97.5, axis=0)
    with np.errstate(divide="ignore", invalid="ignore"):
        rlo = np.where(total > 0, lo / total, 1.0); rhi = np.where(total > 0, hi / total, 1.0)
    out = {"m0": int(M0), "lo": [round(float(x), 4) for x in rlo[M0:]], "hi": [round(float(x), 4) for x in rhi[M0:]],
           "note": "95% bootstrap interval of the calibration ratios (national, day/night x season), as relative factors per month"}
    (WEB_DATA / "uncertainty.json").write_text(json.dumps(out, separators=(",", ":")))
    span = (rhi - rlo)[M0:]
    print("median ±% (VIIRS era 2012+):", round(float(np.median(span[month_index(2012, 1) - M0:]) * 50), 2),
          "| Terra era:", round(float(np.median(span[:month_index(2002, 7) - M0]) * 50), 2),
          "| Aqua era:", round(float(np.median(span[month_index(2003, 1) - M0:month_index(2011, 12) - M0]) * 50), 2))


if __name__ == "__main__":
    main()
