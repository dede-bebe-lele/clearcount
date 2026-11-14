"""ClearCount Early Warning: a machine-learning model that, at the end of month t-1,
predicts whether month t will be ABOVE NORMAL (above the 75th percentile of that
1-degree cell and calendar month) in the harmonized fire record.

Inputs are only things known before month t starts:
  harmonized fire activity in the previous months (from ClearCount), the same month
  last year, the cell's fire climatology, rain / heat / humidity / wind anomalies
  in the previous 1-3 months (NASA POWER), cloud-blindness of the previous month.
Model: gradient-boosted trees (scikit-learn HistGradientBoostingClassifier).
Honest evaluation:
  (1) fixed split: train 2003-2015, test 2016-2025 (the test years never seen);
  (2) leave-one-year-out hindcasts for every year, so every month in the app shows a
      forecast made without knowing that year.
Baselines: climatology (base rate) and persistence (last month above normal -> yes).
Output: web/data/ml.json
"""
import io
import json
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import roc_auc_score, brier_score_loss
from common import WORK, WEB_DATA, GRID, cell_center, month_index

M0 = month_index(2000, 11)
SEASON = range(3, 11)            # forecast target months Mar..Oct (1-based)
POWER_PARAMS = {"PRECTOTCORR": "pr", "T2M_MAX": "tx", "RH2M": "rh", "WS2M": "ws"}
MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def weather_1deg():
    frames = []
    for f in (WORK / "power_monthly").glob("*.csv"):
        p = f.name.split("_")[0]
        body = f.read_text().split("-END HEADER-")[1]
        d = pd.read_csv(io.StringIO(body)).melt(id_vars=["PARAMETER", "YEAR", "LAT", "LON"], value_vars=MON, var_name="MON", value_name="v")
        frames.append(d[d["v"] > -998])
    w = pd.concat(frames)
    w["mi"] = month_index(w["YEAR"], w["MON"].map({m: i + 1 for i, m in enumerate(MON)}))
    w["lat"] = np.floor(w["LAT"]) + .5; w["lon"] = np.floor(w["LON"]) + .5
    w = w.groupby(["lat", "lon", "mi", "PARAMETER"])["v"].mean().unstack("PARAMETER").rename(columns=POWER_PARAMS).reset_index()
    return w


def build_table():
    c = pd.read_pickle(WORK / "harmonized_cells.pkl")
    la, lo = cell_center(c["cell"].values, GRID)
    c["lat"], c["lon"] = np.floor(la) + .5, np.floor(lo) + .5
    fire = c.groupby(["lat", "lon", "mi"])["h"].sum()
    cells = fire.groupby(level=[0, 1]).sum()
    cells = cells[cells >= 20].index            # cells with a real fire history
    months = np.arange(month_index(2001, 1), month_index(2026, 10) + 1)
    idx = pd.MultiIndex.from_tuples([(a, b, m) for a, b in cells for m in months], names=["lat", "lon", "mi"])
    df = fire.reindex(idx, fill_value=0.0).rename("h").reset_index()
    df["year"] = 2000 + df["mi"] // 12
    df["month"] = df["mi"] % 12 + 1
    w = weather_1deg()
    df = df.merge(w, on=["lat", "lon", "mi"], how="left")
    b = pd.read_pickle(WORK / "blind_1deg.pkl")[["lat", "lon", "mi", "blind_days", "days"]]
    b["mi"] = b["mi"] + 0  # blind mi is absolute month index already
    b["blind"] = b["blind_days"] / b["days"]
    df = df.merge(b[["lat", "lon", "mi", "blind"]], on=["lat", "lon", "mi"], how="left")
    df = df.sort_values(["lat", "lon", "mi"]).reset_index(drop=True)
    g = df.groupby(["lat", "lon"], sort=False)
    # lagged features (known at end of month t-1)
    df["lh1"] = np.log1p(g["h"].shift(1)); df["lh2"] = np.log1p(g["h"].shift(2)); df["lh3"] = np.log1p(g["h"].shift(3))
    df["lh12"] = np.log1p(g["h"].shift(12)); df["lh24"] = np.log1p(g["h"].shift(24))
    for v in ["pr", "tx", "rh", "ws", "blind"]:
        df[v + "1"] = g[v].shift(1)
    df["pr3"] = g["pr"].shift(1).rolling(3).mean().reset_index(level=[0, 1], drop=True) if False else g["pr"].transform(lambda s: s.shift(1).rolling(3, min_periods=2).mean())
    df["pr6"] = g["pr"].transform(lambda s: s.shift(1).rolling(6, min_periods=4).mean())
    return df


def add_climatology(df, train_years):
    """Per cell x calendar-month baselines from training years only (no leakage)."""
    t = df[df["year"].isin(train_years)]
    clim = t.groupby(["lat", "lon", "month"]).agg(p75=("h", lambda x: np.percentile(x, 75)), med=("h", "median"), mean=("h", "mean")).reset_index()
    wc = t.groupby(["lat", "lon", "month"])[["pr", "tx", "rh", "ws"]].mean().add_suffix("_c").reset_index()
    out = df.drop(columns=[c for c in df.columns if c in ("p75", "med", "mean") or c.endswith("_c")], errors="ignore")
    out = out.merge(clim, on=["lat", "lon", "month"], how="left").merge(wc, on=["lat", "lon", "month"], how="left")
    # previous calendar month's climatology, for anomalies of lagged values
    prevm = clim.assign(month=clim["month"] % 12 + 1).rename(columns={"p75": "p75_prev", "med": "med_prev", "mean": "mean_prev"})
    out = out.merge(prevm, on=["lat", "lon", "month"], how="left")
    wcp = wc.assign(month=wc["month"] % 12 + 1).rename(columns={"pr_c": "prp_c", "tx_c": "txp_c", "rh_c": "rhp_c", "ws_c": "wsp_c"})
    out = out.merge(wcp, on=["lat", "lon", "month"], how="left")
    out["y"] = (out["h"] > np.maximum(out["p75"], 0.5)).astype(int)
    out["lmed"] = np.log1p(out["med"]); out["lp75"] = np.log1p(out["p75"])
    out["fire_anom1"] = out["lh1"] - np.log1p(out["mean_prev"])
    out["pr_anom1"] = out["pr1"] / out["prp_c"].replace(0, np.nan) - 1
    out["tx_anom1"] = out["tx1"] - out["txp_c"]
    out["rh_anom1"] = out["rh1"] - out["rhp_c"]
    out["ws_anom1"] = out["ws1"] - out["wsp_c"]
    out["msin"] = np.sin(2 * np.pi * out["month"] / 12); out["mcos"] = np.cos(2 * np.pi * out["month"] / 12)
    # persistence baseline: was last month above its own p75?
    out["persist"] = (np.expm1(out["lh1"]) > np.maximum(out["p75_prev"], 0.5)).astype(int)
    return out


FEATS = ["lat", "lon", "msin", "mcos", "lmed", "lp75", "lh1", "lh2", "lh3", "lh12", "lh24", "fire_anom1",
         "pr_anom1", "pr3", "pr6", "tx_anom1", "rh_anom1", "ws_anom1", "blind1"]
NAMES = {"lat": "latitude", "lon": "longitude", "msin": "season", "mcos": "season", "lmed": "typical activity (median)",
         "lp75": "typical activity (p75)", "lh1": "fire last month", "lh2": "fire 2 months ago", "lh3": "fire 3 months ago",
         "lh12": "same month last year", "lh24": "same month 2 years ago", "fire_anom1": "last month's fire anomaly",
         "pr_anom1": "rain anomaly last month", "pr3": "rain, last 3 months", "pr6": "rain, last 6 months",
         "tx_anom1": "heat anomaly last month", "rh_anom1": "humidity anomaly last month", "ws_anom1": "wind anomaly last month",
         "blind1": "cloud-blindness last month"}


def model():
    return HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=40,
                                          l2_regularization=1.0, random_state=0)


def scores(y, p, base_rate):
    bs = brier_score_loss(y, p); bs_ref = brier_score_loss(y, np.full(len(y), base_rate))
    top = np.argsort(-p)[: max(1, len(p) // 10)]
    return {"n": int(len(y)), "events": int(y.sum()), "auc": round(float(roc_auc_score(y, p)), 3),
            "brier_skill_vs_climatology": round(float(1 - bs / bs_ref), 3),
            "hit_rate_top10pct": round(float(y[top].mean()), 3), "base_rate": round(float(base_rate), 3)}


def main():
    raw = build_table()
    years = list(range(2003, 2027))
    # ---- (1) fixed split
    tr_y, te_y = list(range(2003, 2016)), list(range(2016, 2027))
    df = add_climatology(raw, tr_y)
    df = df[df["month"].isin(SEASON) & df["year"].between(2003, 2026)].dropna(subset=["lh1", "lh12"])
    tr, te = df[df["year"].isin(tr_y)], df[df["year"].isin(te_y)]
    m = model().fit(tr[FEATS], tr["y"])
    p = m.predict_proba(te[FEATS])[:, 1]
    base = tr["y"].mean()
    res = {"split": {"train_years": [2003, 2015], "test_years": [2016, 2025], "model": scores(te["y"].values, p, base),
                     "persistence_auc": round(float(roc_auc_score(te["y"], te["persist"])), 3),
                     "persistence_hit_rate": round(float(te.loc[te["persist"] == 1, "y"].mean()), 3),
                     "climatology_auc": 0.5}}
    pi = permutation_importance(m, te[FEATS], te["y"], scoring="roc_auc", n_repeats=5, random_state=0)
    imp = {}
    for f_, v in zip(FEATS, pi.importances_mean):
        imp[NAMES[f_]] = imp.get(NAMES[f_], 0) + float(v)
    res["importance"] = sorted([[k, round(v, 4)] for k, v in imp.items()], key=lambda x: -x[1])
    print(json.dumps(res["split"], indent=1)); print(res["importance"][:8])

    # ---- (2) leave-one-year-out hindcasts for every year 2003-2025
    preds = []
    for y in years:
        trn = [x for x in years if x != y]
        d = add_climatology(raw, trn)
        d = d[d["month"].isin(SEASON) & d["year"].between(2003, 2026)].dropna(subset=["lh1", "lh12"])
        mm = model().fit(d[d["year"] != y][FEATS], d[d["year"] != y]["y"])
        q = d[d["year"] == y]
        preds.append(q[["lat", "lon", "mi", "y", "p75"]].assign(p=mm.predict_proba(q[FEATS])[:, 1]))
    P = pd.concat(preds)
    res["loyo"] = scores(P["y"].values, P["p"].values, P["y"].mean())
    print("LOYO", res["loyo"])
    cells = []
    for (la, lo), g in P.groupby(["lat", "lon"]):
        cells.append([float(la), float(lo), (g["mi"] - M0).astype(int).tolist(), [round(float(x), 3) for x in g["p"]], g["y"].astype(int).tolist()])
    res["cells"] = cells
    res["definition"] = "P(month above the 75th percentile of the same calendar month for that 1-degree cell), issued at the end of the previous month"
    prev = WEB_DATA / "ml.json"
    if prev.exists():
        try:
            old = json.loads(prev.read_text())
            if "raw_vs_harmonized" in old:
                res["raw_vs_harmonized"] = old["raw_vs_harmonized"]
        except Exception:
            pass
    (WEB_DATA / "ml.json").write_text(json.dumps(res, separators=(",", ":")))
    print("cells", len(cells))


if __name__ == "__main__":
    main()
