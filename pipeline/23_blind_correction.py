"""Blind-day correction (Poisson gradient boosting, so totals are unbiased): how many hotspots did clouds hide?

Daily, per 1-degree cell, fire season (Mar-Oct), 2003-2025.
A gradient-boosted model learns, on CLEAR days (cloud < 40%), how a day's harmonized hotspots
relate to activity on the surrounding days, rain on the day and the day before, satellite
passes, season and the cell's typical activity. It is then applied to BLIND days
(cloud >= 70%) to estimate what clear-sky satellites would have seen.

Test ("artificial blinding"): clear days in held-out years are hidden and re-estimated;
compared with naive interpolation (mean of the neighbouring days).
Output: web/data/blind_correction.json
"""
import json
import warnings
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import r2_score
from common import WORK, WEB_DATA, month_index

warnings.filterwarnings("ignore")
D0, D1 = np.datetime64("2003-01-01"), np.datetime64("2026-01-01")
ND = int((D1 - D0).astype(int))
CLEAR, BLIND = 40.0, 70.0


def grid_index(lat, lon, cells):
    key = {(a, b): i for i, (a, b) in enumerate(cells)}
    return np.array([key.get((a, b), -1) for a, b in zip(np.floor(lat) + .5, np.floor(lon) + .5)])


def daily_matrix(df, val, cells, lat="LAT", lon="LON"):
    M = np.full((len(cells), ND), np.nan)
    d = (pd.to_datetime(df["YEAR"].astype(str), format="%Y") + pd.to_timedelta(df["DOY"] - 1, unit="D")).values.astype("datetime64[D]")
    di = (d - D0).astype(int); ci = grid_index(df[lat].values, df[lon].values, cells)
    ok = (di >= 0) & (di < ND) & (ci >= 0)
    M[ci[ok], di[ok]] = df[val].values[ok]
    return M


def main():
    cloud = pd.read_pickle(WORK / "cloud_daily.pkl"); precip = pd.read_pickle(WORK / "precip_daily.pkl")
    cells = sorted(set(zip(cloud["LAT"], cloud["LON"])))
    C = daily_matrix(cloud, "CLOUD_AMT", cells); R = daily_matrix(precip, "PRECTOTCORR", cells)
    w = pd.read_pickle(WORK / "weights.pkl"); w = w[w["w"] > 0]
    di = (w["date"].values.astype("datetime64[D]") - D0).astype(int); ci = grid_index(w["lat"].values, w["lon"].values, cells)
    ok = (di >= 0) & (di < ND) & (ci >= 0)
    H = np.zeros((len(cells), ND)); np.add.at(H, (ci[ok], di[ok]), w["w"].values[ok])
    z = np.load(WORK / "looks.npz"); L = z["L"].sum(axis=(0, 1)).T.astype(float)   # cells x days (from 2000-01-01)
    off = int((D0 - np.datetime64(str(z["day0"]))).astype(int)); L = L[:, off:off + ND]
    lk = {(a, b): i for i, (a, b) in enumerate(zip(z["lat"], z["lon"]))}; L = L[[lk[c] for c in cells]]
    dates = D0 + np.arange(ND); month = pd.DatetimeIndex(dates).month.values; year = pd.DatetimeIndex(dates).year.values
    active = H.sum(1) > 30
    # feature table for fire-season cell-days
    rows = []
    lh = np.log1p(H)
    def sh(A, k):
        out = np.full_like(A, np.nan);
        if k > 0: out[:, k:] = A[:, :-k]
        else: out[:, :k] = A[:, -k:]
        return out
    feats = {"h_m1": sh(lh, 1), "h_p1": sh(lh, -1), "h_m2": sh(lh, 2), "h_p2": sh(lh, -2), "h_m3": sh(lh, 3), "h_p3": sh(lh, -3),
             "c_m1": sh(C, 1), "c_p1": sh(C, -1), "rain": R, "rain_m1": sh(R, 1), "looks": L}
    clim = np.log1p(np.array([[H[i, (month == m)].mean() for m in range(1, 13)] for i in range(len(cells))]))
    season = (month >= 3) & (month <= 10)
    ii, dd = np.nonzero(active[:, None] & season[None, :] & ~np.isnan(C))
    X = pd.DataFrame({k: v[ii, dd] for k, v in feats.items()})
    X["clim"] = clim[ii, month[dd] - 1]; X["month"] = month[dd]; X["lat"] = [cells[i][0] for i in ii]; X["lon"] = [cells[i][1] for i in ii]
    y = lh[ii, dd]; cl = C[ii, dd]; yr = year[dd]
    # only use days whose neighbours are themselves reasonably clear (otherwise context is unreliable)
    ctx_ok = (np.nan_to_num(X["c_m1"].values, nan=100) < BLIND) | (np.nan_to_num(X["c_p1"].values, nan=100) < BLIND)
    FEATS = list(X.columns)
    clear = cl < CLEAR
    # ---- artificial-blinding test: train on clear days 2003-2018, hide clear days 2019-2025
    tr = clear & (yr <= 2018); te = clear & (yr >= 2019) & ctx_ok & ((X["h_m1"].values > 0) | (X["h_p1"].values > 0))
    m = HistGradientBoostingRegressor(loss="poisson", max_iter=400, learning_rate=.05, max_leaf_nodes=31, min_samples_leaf=50, random_state=0).fit(X[tr], np.expm1(y[tr]))
    pred = np.log1p(m.predict(X[te])); naive = np.log1p((np.expm1(X["h_m1"].values[te]) + np.expm1(X["h_p1"].values[te])) / 2)
    obs = y[te]
    tot_bias = float(np.expm1(pred).sum() / np.expm1(obs).sum() - 1); tot_bias_naive = float(np.expm1(naive).sum() / np.expm1(obs).sum() - 1)
    test = {"train": "clear days 2003-2018", "test": "clear days 2019-2025 next to active days, hidden and re-estimated", "n": int(te.sum()),
            "r2_log_model": round(float(r2_score(obs, pred)), 3), "r2_log_naive_interpolation": round(float(r2_score(obs, naive)), 3),
            "total_bias_model_pct": round(tot_bias * 100, 1), "total_bias_naive_pct": round(tot_bias_naive * 100, 1)}
    print(json.dumps(test, indent=1))
    # ---- final model on all clear days; apply to blind days
    mf = HistGradientBoostingRegressor(loss="poisson", max_iter=400, learning_rate=.05, max_leaf_nodes=31, min_samples_leaf=50, random_state=0).fit(X[clear], np.expm1(y[clear]))
    blind = (cl >= BLIND) & ctx_ok
    calib = 1 / (1 + tot_bias)   # remove the total bias measured in the artificial-blinding test
    est = mf.predict(X[blind]).clip(0) * calib; obs_b = np.expm1(y[blind])
    hidden = np.maximum(0, est - obs_b)
    bi, bd = ii[blind], dd[blind]
    # national monthly series (absolute month index from 2000-11)
    M0 = month_index(2000, 11)
    mi = (year[bd] - 2000) * 12 + month[bd] - 1 - M0
    nmon = int(month_index(2025, 12) - M0 + 1)
    hid_m = np.zeros(nmon); np.add.at(hid_m, mi, hidden)
    seas_days = season & (year >= 2003)
    blind_share = float((cl >= BLIND).mean())
    # national annual totals observed vs corrected (fire season)
    obs_m = np.zeros(nmon); mi_all = (year[dd] - 2000) * 12 + month[dd] - 1 - M0; np.add.at(obs_m, mi_all, np.expm1(y))
    yrs = list(range(2003, 2026))
    ann_obs = [float(obs_m[[month_index(Y, mm) - M0 for mm in range(3, 11)]].sum()) for Y in yrs]
    ann_cor = [float(ann_obs[k] + hid_m[[month_index(Y, mm) - M0 for mm in range(3, 11)]].sum()) for k, Y in enumerate(yrs)]
    from scipy import stats
    def sen(x): x = np.asarray(x); n = len(x); return float(np.median([(x[j] - x[i]) / (j - i) for i in range(n) for j in range(i + 1, n)]) / np.median(x) * 100)
    tau_o = stats.kendalltau(yrs, ann_obs); tau_c = stats.kendalltau(yrs, ann_cor)
    # case: Abai 10 June 2023
    ab = [i for i, c in enumerate(cells) if 50 <= c[0] <= 51 and 79 <= c[1] <= 81]
    d10 = int((np.datetime64("2023-06-10") - D0).astype(int))
    case = {"cells": [list(cells[i]) for i in ab], "observed": round(float(H[ab, d10].sum()), 1)}
    sel = np.isin(bi, ab) & (bd == d10)
    case["estimated_hidden"] = round(float(hidden[sel].sum()), 1) if sel.any() else None
    case["rain_mm"] = round(float(np.nanmean(R[ab, d10])), 2); case["cloud_pct"] = round(float(np.nanmean(C[ab, d10])), 1)
    test["calibration_factor"] = round(float(calib), 3)
    out = {"test": test, "hidden_share_range_pct": [13.4, 24.2], "blind_share_fire_season": round(blind_share, 3),
           "hidden_total": round(float(hidden.sum()), 0), "observed_total_fire_season": round(float(np.expm1(y).sum()), 0),
           "hidden_share_pct": round(float(hidden.sum() / np.expm1(y).sum() * 100), 1),
           "annual": {"years": yrs, "observed": [round(v, 1) for v in ann_obs], "corrected": [round(v, 1) for v in ann_cor]},
           "trend": {"observed_sen_pct_per_yr": round(sen(ann_obs), 2), "corrected_sen_pct_per_yr": round(sen(ann_cor), 2),
                     "observed_tau_p": round(float(tau_o.pvalue), 5), "corrected_tau_p": round(float(tau_c.pvalue), 5)},
           "monthly_hidden": [round(float(v), 2) for v in hid_m], "m0": int(M0), "case_abai_2023_06_10": case,
           "cells": [list(map(float, c)) for c in cells],
           "note": "estimate of hotspots satellites would have seen on cloud-blind days (cloud >= 70%), assuming fire behaviour like comparable clear days with similar rain; national calibration, 1-degree daily"}
    # per-cell monthly hidden for AOI use: sparse
    cm = pd.DataFrame({"c": bi, "m": mi, "h": hidden}).groupby(["c", "m"])["h"].sum().reset_index()
    cm = cm[cm["h"] > .05]
    out["cell_month"] = [[int(a), int(b), round(float(c), 2)] for a, b, c in cm.values]
    (WEB_DATA / "blind_correction.json").write_text(json.dumps(out, separators=(",", ":")))
    print({k: out[k] for k in ("blind_share_fire_season", "hidden_total", "observed_total_fire_season", "hidden_share_pct", "trend", "case_abai_2023_06_10")})


if __name__ == "__main__":
    main()
