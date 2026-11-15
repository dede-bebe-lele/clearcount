"""Per-area reliability: how well does the VIIRS-based record reproduce real MODIS Aqua counts
in years the calibration never saw?

Ratios are fitted on CAL_TRAIN (2012-2017) exactly as in 03_harmonize.py, then S-NPP detections
in CAL_TEST (2018-2021) are converted to the Aqua scale and compared with what Aqua actually
recorded. Results are stored per 1-degree cell and test year so the web app can sum them over any
area the user draws and report the typical miss for that area.
"""
import importlib.util, json
import numpy as np
from common import WORK, WEB_DATA, CAL_TRAIN, CAL_TEST, BLOCK, cell_id, month_index, load_points

spec = importlib.util.spec_from_file_location("h", str(WORK.parents[1] / "pipeline" / "03_harmonize.py"))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)


def main():
    p = load_points()
    p = p[p["keep"]].reset_index(drop=True)
    p["season"] = h.season_of(p["month"])
    p["block"] = cell_id(p["lat"], p["lon"], BLOCK)
    p["mi"] = month_index(p["year"], p["month"])
    sat = p["sat"].astype(str).values
    m_as = h.fit_ratio(p, "Aqua", "N", CAL_TRAIN)
    test = p["year"].between(*CAL_TEST).values
    q = p[test & ((sat == "Aqua") | (sat == "N"))].copy()
    qs = q["sat"].astype(str).values
    q["w"] = np.where(qs == "N", h.apply_ratio(m_as, q["block"].values, q["dn"].values, q["season"].values), 1.0)
    q["la"] = np.floor(q["lat"]).astype(int)
    q["lo"] = np.floor(q["lon"]).astype(int)
    q["is_obs"] = qs == "Aqua"
    obs = q[q["is_obs"]].groupby(["la", "lo", "mi"]).size()
    pred = q[~q["is_obs"]].groupby(["la", "lo", "mi"])["w"].sum()
    idx = obs.index.union(pred.index)
    obs, pred = obs.reindex(idx, fill_value=0), pred.reindex(idx, fill_value=0.0)
    y0, y1 = CAL_TEST
    yr = lambda mi: 2000 + int(mi) // 12
    cells = []
    for (la, lo), g in obs.groupby(level=[0, 1]):
        o = [0] * (y1 - y0 + 1); pr = [0.0] * (y1 - y0 + 1)
        for (_, _, mi), v in g.items(): o[yr(mi) - y0] += int(v)
        for (_, _, mi), v in pred.loc[g.index].items(): pr[yr(mi) - y0] += float(v)
        cells.append([int(la), int(lo), o, [int(round(v)) for v in pr]])
    out = {"cell_deg": 1, "train_years": list(CAL_TRAIN), "test_years": list(CAL_TEST),
           "note": "Per 1-degree cell (south-west corner) and test year: MODIS Aqua observed hotspots vs. VIIRS S-NPP "
                   "converted to the Aqua scale with ratios fitted on the training years only.",
           "cells": cells}
    (WEB_DATA / "reliability.json").write_text(json.dumps(out, separators=(",", ":")))
    tot_o, tot_p = float(obs.sum()), float(pred.sum())
    print(f"cells={len(cells)} obs={tot_o:.0f} pred={tot_p:.0f} bias={100 * (tot_p / tot_o - 1):+.1f}%")


if __name__ == "__main__":
    main()
