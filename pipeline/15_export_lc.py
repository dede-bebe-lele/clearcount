"""Export the land-cover split of the harmonized record (MCD12Q1 2020, IGBP groups) for the web:
per 0.25-degree cell, monthly harmonized hotspots in cropland and forest (steppe = rest)."""
import json
import pandas as pd
from common import WORK, WEB_DATA, GRID, cell_center, month_index

M0 = month_index(2000, 11)
c = pd.read_pickle(WORK / "harmonized_cells_lc.pkl")
out = {}
for grp in ["cropland", "forest"]:
    g = c[c["lc"] == grp]
    cells = {}
    for cid, q in g.groupby("cell"):
        la, lo = cell_center([cid], GRID)
        cells[f"{la[0]:.3f},{lo[0]:.3f}"] = [(q["mi"] - M0).astype(int).tolist(), [round(float(x), 2) for x in q["w"]]]
    out[grp] = cells
out["note"] = "MCD12Q1 v061 2020 LC_Type1 (IGBP): forest = classes 1-5; cropland = 12, 14; steppe/shrub/savanna/grass = 6-10; harmonized hotspots"
(WEB_DATA / "landcover.json").write_text(json.dumps(out, separators=(",", ":")))
print({k: len(v) for k, v in out.items() if k != "note"})
