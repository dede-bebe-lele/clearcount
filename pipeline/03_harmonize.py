"""Harmonize MODIS and VIIRS FIRMS hotspots into one consistent monthly record,
expressed in MODIS-Aqua-equivalent hotspots.

Reference sensor: MODIS Aqua (the record INPE and GWIS also anchor to).
  2000-11 .. 2002-06  Terra only   -> Terra x k(Aqua/Terra)   [bridge]
  2002-07 .. 2011-12  Aqua         -> Aqua as observed
  2012-01 .. present  VIIRS S-NPP  -> S-NPP x k(Aqua/S-NPP)   [calibrated on clean 2012-2017 overlap]
  after S-NPP ends    VIIRS NOAA-20 -> N20 x k(S-NPP/N20) x k(Aqua/S-NPP)

Each k is a hierarchical, shrunken ratio estimator:
  national(day/night) -> 3-degree block(day/night) -> block(day/night, season)
  k_child = (A_child + lam * k_parent) / (B_child + lam)
so sparse blocks fall back smoothly to their parent.

Outputs (data/work): harmonized_cells.pkl, weights.pkl, validation.json, national.csv
"""
import json
import numpy as np
import pandas as pd
from scipy import stats
from common import (WORK, GRID, BLOCK, CAL_TRAIN, CAL_TEST, cell_id, season_of,
                    month_index, load_points)

LAM = 300.0  # shrinkage pseudo-count, in units of the denominator sensor's detections
# S-NPP and NOAA-20 carry identical VIIRS instruments: block/season differences are
# sampling noise (overpass phasing), not sensitivity, so pool much more strongly.
LAM_TWIN = 20000.0


def counts(p, sat, years):
    q = p[(p["sat"] == sat) & p["year"].between(*years)]
    return q.groupby(["block", "dn", "season"]).size()


def fit_ratio(p, num_sat, den_sat, years, lam=LAM):
    """Hierarchical ratio k = num/den by (block, dn, season)."""
    A = counts(p, num_sat, years)
    B = counts(p, den_sat, years)
    idx = A.index.union(B.index)
    A, B = A.reindex(idx, fill_value=0), B.reindex(idx, fill_value=0)
    df = pd.DataFrame({"A": A, "B": B}).reset_index()
    nat = df.groupby("dn")[["A", "B"]].sum()
    k_nat = (nat["A"] / nat["B"]).to_dict()
    blk = df.groupby(["block", "dn"])[["A", "B"]].sum().reset_index()
    blk["k"] = (blk["A"] + lam * blk["dn"].map(k_nat)) / (blk["B"] + lam)
    kb = blk.set_index(["block", "dn"])["k"]
    df["k_parent"] = [kb[(b, d)] for b, d in zip(df["block"], df["dn"])]
    df["k"] = (df["A"] + lam * df["k_parent"]) / (df["B"] + lam)
    return {"nat": k_nat, "block": kb.to_dict(),
            "full": df.set_index(["block", "dn", "season"])["k"].to_dict()}


def apply_ratio(model, block, dn, season):
    out = np.empty(len(block), dtype="float32")
    for i, key in enumerate(zip(block, dn, season)):
        k = model["full"].get(key)
        if k is None:
            k = model["block"].get(key[:2], model["nat"][key[1]])
        out[i] = k
    return out


def monthly(p, mask, weight=None):
    q = p[mask]
    w = np.ones(len(q)) if weight is None else weight[mask]
    return pd.Series(w, index=q["mi"].values).groupby(level=0).sum()


def block_month(p, mask, weight=None):
    q = p[mask]
    w = np.ones(len(q)) if weight is None else weight[mask]
    return pd.Series(w, index=pd.MultiIndex.from_arrays([q["block"].values, q["mi"].values])).groupby(level=[0, 1]).sum()


def skill(obs, pred):
    """Metrics on block-months with activity."""
    df = pd.DataFrame({"o": obs, "p": pred}).fillna(0)
    df = df[(df["o"] + df["p"]) > 0]
    lo, lp = np.log1p(df["o"]), np.log1p(df["p"])
    r2 = 1 - ((lo - lp) ** 2).sum() / ((lo - lo.mean()) ** 2).sum()
    return {"n": int(len(df)), "r2_log": round(float(r2), 3),
            "bias_pct": round(float((df["p"].sum() / df["o"].sum() - 1) * 100), 1),
            "spearman": round(float(stats.spearmanr(df["o"], df["p"]).correlation), 3)}


def kappa_p90(obs, pred, thresh):
    """Cohen's kappa on 'month above its own p90' using thresholds from a baseline."""
    df = pd.DataFrame({"o": obs, "p": pred}).fillna(0).reset_index()
    df.columns = ["block", "mi", "o", "p"]
    df["cm"] = df["mi"] % 12
    t = df.set_index(["block", "cm"]).index.map(lambda k: thresh.get(k, np.inf))
    a, b = df["o"].values > t, df["p"].values > t
    po = (a == b).mean()
    pe = a.mean() * b.mean() + (1 - a.mean()) * (1 - b.mean())
    return {"kappa": round(float((po - pe) / (1 - pe)), 3) if pe < 1 else None,
            "events_obs": int(a.sum()), "events_pred": int(b.sum()), "agree": round(float(po), 3)}


def pettitt(x):
    """Pettitt change-point test. Returns (index, p-value)."""
    x = np.asarray(x, float)
    n = len(x)
    r = stats.rankdata(x)
    k = np.arange(1, n)
    u = 2 * np.cumsum(r)[:-1] - k * (n + 1)
    t = int(np.argmax(np.abs(u)))
    K = np.abs(u[t])
    p = 2 * np.exp(-6 * K ** 2 / (n ** 3 + n ** 2))
    return t + 1, float(min(1.0, p))


def main():
    p = load_points()
    p = p[p["keep"]].reset_index(drop=True)
    p["season"] = season_of(p["month"])
    p["block"] = cell_id(p["lat"], p["lon"], BLOCK)
    p["cell"] = cell_id(p["lat"], p["lon"], GRID)
    p["mi"] = month_index(p["year"], p["month"])
    print(f"Landscape-fire detections: {len(p):,}")

    sat = p["sat"].astype(str).values
    v = {}

    # ---------- 1) Aqua / S-NPP: naive single ratio vs hierarchical, held-out years
    naive_k = (p[(sat == "Aqua") & p["year"].between(*CAL_TRAIN)].shape[0] /
               p[(sat == "N") & p["year"].between(*CAL_TRAIN)].shape[0])
    m_as = fit_ratio(p, "Aqua", "N", CAL_TRAIN)
    test = p["year"].between(*CAL_TEST).values
    is_n, is_aqua = sat == "N", sat == "Aqua"
    k_pts = apply_ratio(m_as, p["block"].values, p["dn"].values, p["season"].values)
    obs = block_month(p, is_aqua & test)
    pred_h = block_month(p, is_n & test, k_pts)
    pred_n = block_month(p, is_n & test) * naive_k
    # p90 thresholds per (block, calendar month) from Aqua 2003-2011 (independent of VIIRS)
    base = p[is_aqua & p["year"].between(2003, 2011)]
    bm = base.groupby(["block", "year", "month"]).size().unstack("year", fill_value=0)
    thresh = {(b, m - 1): float(np.percentile(row.values, 90)) for (b, m), row in bm.iterrows()}
    v["aqua_snpp"] = {
        "train_years": list(CAL_TRAIN), "test_years": list(CAL_TEST),
        "national_ratio_day": round(m_as["nat"][0], 4), "national_ratio_night": round(m_as["nat"][1], 4),
        "naive_single_ratio": round(naive_k, 4),
        "test_hierarchical": skill(obs, pred_h), "test_naive": skill(obs, pred_n),
        "kappa_p90_hierarchical": kappa_p90(obs, pred_h, thresh),
        "kappa_p90_naive": kappa_p90(obs, pred_n, thresh),
    }
    print("Aqua/S-NPP", json.dumps(v["aqua_snpp"], indent=1))

    # final model uses the whole clean overlap
    m_as = fit_ratio(p, "Aqua", "N", (2012, 2021))
    k_as = apply_ratio(m_as, p["block"].values, p["dn"].values, p["season"].values)

    # ---------- 2) Terra bridge (Aqua/Terra), train 2003-2008, test 2009-2011
    m_ta = fit_ratio(p, "Aqua", "Terra", (2003, 2008))
    k_ta = apply_ratio(m_ta, p["block"].values, p["dn"].values, p["season"].values)
    tt = p["year"].between(2009, 2011).values
    v["terra_bridge"] = {"train_years": [2003, 2008], "test_years": [2009, 2011],
                         "test": skill(block_month(p, is_aqua & tt), block_month(p, (sat == "Terra") & tt, k_ta))}
    m_ta = fit_ratio(p, "Aqua", "Terra", (2003, 2011))
    k_ta = apply_ratio(m_ta, p["block"].values, p["dn"].values, p["season"].values)

    # ---------- 3) NOAA-20 handover (S-NPP/N20), train 2018-2023, test 2024-2025
    is_n20 = sat == "N20"
    m_n = fit_ratio(p, "N", "N20", (2018, 2023), LAM_TWIN)
    k_n = apply_ratio(m_n, p["block"].values, p["dn"].values, p["season"].values)
    t2 = p["year"].between(2024, 2025).values
    v["noaa20_handover"] = {"train_years": [2018, 2023], "test_years": [2024, 2025],
                            "test": skill(block_month(p, is_n & t2), block_month(p, is_n20 & t2, k_n))}
    m_n = fit_ratio(p, "N", "N20", (2018, 2025), LAM_TWIN)
    k_n = apply_ratio(m_n, p["block"].values, p["dn"].values, p["season"].values)

    # ---------- 4) per-detection harmonized weight
    mi = p["mi"].values
    w = np.zeros(len(p), dtype="float32")
    terra_only = (sat == "Terra") & (mi < month_index(2002, 7))
    w[terra_only] = k_ta[terra_only]
    aqua_era = is_aqua & (mi >= month_index(2002, 7)) & (mi < month_index(2012, 1))
    w[aqua_era] = 1.0
    # S-NPP is the VIIRS reference until it degraded (non-nominal from 10 Jul 2026; data ended 2 Nov 2026).
    # From then on, and in any month without S-NPP data, NOAA-20 carries the record via the N20->S-NPP ratio.
    SNPP_END = np.datetime64("2026-07-10")
    dates = p["date"].values.astype("datetime64[D]")
    viirs_era = is_n & (mi >= month_index(2012, 1)) & (dates < SNPP_END)
    w[viirs_era] = k_as[viirs_era]
    snpp_months = set(np.unique(mi[is_n & (dates < SNPP_END)]))
    n20_fallback = is_n20 & ((dates >= SNPP_END) | ~np.isin(mi, list(snpp_months)))
    w[n20_fallback] = (k_n * k_as)[n20_fallback]
    p["w"] = w
    # alternative chain for the continuity test: NOAA-20 instead of S-NPP for 2024-2025
    w_alt = w.copy()
    w_alt[is_n & (mi >= month_index(2024, 1))] = 0
    sel = is_n20 & (mi >= month_index(2024, 1))
    w_alt[sel] = (k_n * k_as)[sel]

    # ---------- 5) national series and step tests
    months = np.arange(month_index(2000, 11), mi.max() + 1)
    nat = pd.DataFrame(index=months)
    nat["raw_all"] = monthly(p, np.ones(len(p), bool)).reindex(months, fill_value=0)
    for s in ["Terra", "Aqua", "N", "N20", "N21"]:
        nat[s] = monthly(p, sat == s).reindex(months, fill_value=0)
    nat["harmonized"] = monthly(p, w > 0, w).reindex(months, fill_value=0)
    nat["harmonized_n20chain"] = monthly(p, w_alt > 0, w_alt).reindex(months, fill_value=0)
    nat["year"] = 2000 + nat.index // 12
    nat["month"] = nat.index % 12 + 1

    def step_at(series, ref, m0, span=48):
        """Median log-ratio to the Aqua reference after vs before m0 (cell: national)."""
        r = np.log((series + 1) / (ref + 1))
        before = r[(r.index >= m0 - span) & (r.index < m0)]
        after = r[(r.index >= m0) & (r.index < m0 + span)]
        return round(float(np.median(after) - np.median(before)), 3)

    m2012 = month_index(2012, 1)
    v["step_2012"] = {
        "raw_all_sensors_vs_aqua": step_at(nat["raw_all"], nat["Aqua"], m2012),
        "harmonized_vs_aqua": step_at(nat["harmonized"], nat["Aqua"], m2012),
        "note": "median log-ratio change at Jan 2012, 4 years either side; 0 = no step",
    }
    # Pettitt on deseasonalized log series 2006-2017 relative to Aqua
    win = (nat.index >= month_index(2006, 1)) & (nat.index < month_index(2018, 1))
    for col in ["raw_all", "harmonized"]:
        r = np.log((nat.loc[win, col] + 1) / (nat.loc[win, "Aqua"] + 1)).values
        t, pv = pettitt(r)
        v.setdefault("pettitt_2006_2017", {})[col] = {
            "change_point": f"{2006 + t // 12}-{t % 12 + 1:02d}", "p_value": round(pv, 5)}
    a, b = nat.loc[nat.index >= month_index(2024, 1), "harmonized"], nat.loc[nat.index >= month_index(2024, 1), "harmonized_n20chain"]
    v["continuity_snpp_to_noaa20"] = {
        "period": "2024-2025", "total_ratio_n20chain_over_snppchain": round(float(b.sum() / a.sum()), 3),
        "monthly_spearman": round(float(stats.spearmanr(a, b).correlation), 3),
        "note": "simulates the 2 Nov 2026 loss of S-NPP: NOAA-20 replaces S-NPP from Jan 2024"}
    print(json.dumps({k: v[k] for k in ["terra_bridge", "noaa20_handover", "step_2012",
                                        "pettitt_2006_2017", "continuity_snpp_to_noaa20"]}, indent=1))

    # ---------- 6) save
    v["counts"] = {s: int((sat == s).sum()) for s in ["Terra", "Aqua", "N", "N20", "N21"]}
    v["ratios"] = {"aqua_per_snpp": {"day": round(m_as["nat"][0], 4), "night": round(m_as["nat"][1], 4)},
                   "aqua_per_terra": {"day": round(m_ta["nat"][0], 4), "night": round(m_ta["nat"][1], 4)},
                   "snpp_per_noaa20": {"day": round(m_n["nat"][0], 4), "night": round(m_n["nat"][1], 4)}}
    (WORK / "validation.json").write_text(json.dumps(v, indent=1))
    nat.to_csv(WORK / "national.csv")
    p[["lat", "lon", "date", "hhmm", "sat", "frp", "conf", "dn", "cell", "mi", "w", "year", "month"]].to_pickle(WORK / "weights.pkl")
    cells = p.groupby(["cell", "mi"]).agg(h=("w", "sum"), raw=("w", "size")).reset_index()
    cells.to_pickle(WORK / "harmonized_cells.pkl")
    print("saved; cells-months:", len(cells))


if __name__ == "__main__":
    main()
