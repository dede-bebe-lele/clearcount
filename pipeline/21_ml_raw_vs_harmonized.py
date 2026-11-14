"""Does harmonization make the early-warning model better?
Same model, same weather inputs, same target (month above the 75th percentile on the
harmonized record), leave-one-year-out; the ONLY difference is whether the fire-history
features come from the raw FIRMS sum or from the harmonized record.
Output: merged into web/data/ml.json as "raw_vs_harmonized"
"""
import importlib.util
import json
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, brier_score_loss, average_precision_score
from common import WORK, WEB_DATA, GRID, cell_center, month_index

spec = importlib.util.spec_from_file_location("ml", str(__import__("pathlib").Path(__file__).with_name("13_ml_outlook.py")))
ml = importlib.util.module_from_spec(spec); spec.loader.exec_module(ml)


def table(src):
    """build_table, with fire-history features from `src` ('h' or 'raw'); keep harmonized h for the label."""
    c = pd.read_pickle(WORK / "harmonized_cells.pkl")
    la, lo = cell_center(c["cell"].values, GRID)
    c["lat"], c["lon"] = np.floor(la) + .5, np.floor(lo) + .5
    h = c.groupby(["lat", "lon", "mi"])["h"].sum()
    f = c.groupby(["lat", "lon", "mi"])[src].sum().astype(float)
    df = ml.build_table()  # harmonized table with weather + harmonized lags
    if src == "h":
        return df
    fz = f.reindex(pd.MultiIndex.from_frame(df[["lat", "lon", "mi"]]), fill_value=0).values
    df = df.assign(_f=fz)
    g = df.groupby(["lat", "lon"], sort=False)["_f"]
    for k, lag in (("lh1", 1), ("lh2", 2), ("lh3", 3), ("lh12", 12), ("lh24", 24)):
        df[k] = np.log1p(g.shift(lag))
    return df


def run(src):
    raw = table(src)
    years = list(range(2003, 2027)); P = []
    for y in years:
        trn = [x for x in years if x != y]
        d = ml.add_climatology(raw, trn)        # label from harmonized h (y column)
        if src != "h":
            # climatology FEATURES from the raw series (labels stay harmonized)
            t = raw[raw["year"].isin(trn)].assign(_ff=np.expm1(raw["lh1"]).shift(-1))
        d = d[d["month"].isin(ml.SEASON) & d["year"].between(2003, 2026)].dropna(subset=["lh1", "lh12"])
        m = ml.model().fit(d[d["year"] != y][ml.FEATS], d[d["year"] != y]["y"])
        q = d[d["year"] == y]
        P.append(pd.DataFrame({"y": q["y"].values, "p": m.predict_proba(q[ml.FEATS])[:, 1], "persist": q["persist"].values}))
    P = pd.concat(P)
    base = P["y"].mean()
    return {"auc": round(float(roc_auc_score(P.y, P.p)), 3), "pr_auc": round(float(average_precision_score(P.y, P.p)), 3),
            "brier_skill_vs_climatology": round(float(1 - brier_score_loss(P.y, P.p) / brier_score_loss(P.y, np.full(len(P), base))), 3),
            "brier_skill_vs_persistence": round(float(1 - brier_score_loss(P.y, P.p) / brier_score_loss(P.y, P.persist.clip(.05, .95))), 3),
            "top10_hit_rate": round(float(P.y.values[np.argsort(-P.p.values)[: len(P) // 10]].mean()), 3), "base_rate": round(float(base), 3), "n": int(len(P))}


def main():
    res = {"harmonized_features": run("h"), "raw_features": run("raw"),
           "note": "same model, weather and target; leave-one-year-out 2003-2026; only the fire-history features differ"}
    print(json.dumps(res, indent=1))
    f = WEB_DATA / "ml.json"; d = json.loads(f.read_text()); d["raw_vs_harmonized"] = res
    f.write_text(json.dumps(d, separators=(",", ":")))


if __name__ == "__main__":
    main()
