"""Shared paths and helpers for the ClearCount pipeline."""
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
WEB_DATA = ROOT / "web" / "data"
STATIC = ROOT / "pipeline" / "static"   # small committed inputs (country/region boundaries)
for p in (WORK, WEB_DATA):
    p.mkdir(parents=True, exist_ok=True)

COUNTRY = "Kazakhstan"
GRID = 0.25            # analysis grid (degrees) for the calendar
BLOCK = 3.0            # calibration block size (degrees)
FLARE_CELL = 0.02      # persistence-mask cell (~2 km)

# Fixed baseline period for medians/percentiles (before Terra/Aqua orbit drift)
BASE_START, BASE_END = 2003, 2021
# Clean MODIS-Aqua / VIIRS-S-NPP overlap used for calibration (both ~13:30 overpass)
CAL_TRAIN = (2012, 2017)
CAL_TEST = (2018, 2021)

SAT_LABEL = {"Terra": "MODIS Terra", "Aqua": "MODIS Aqua", "N": "VIIRS S-NPP",
             "N20": "VIIRS NOAA-20", "N21": "VIIRS NOAA-21"}


def season_of(month):
    """Meteorological season index 0..3 (DJF, MAM, JJA, SON)."""
    return ((np.asarray(month) % 12) // 3).astype(np.int8)


def month_index(year, month):
    return (np.asarray(year) - 2000) * 12 + (np.asarray(month) - 1)


def cell_id(lat, lon, size):
    """Integer id of a lat/lon grid cell."""
    i = np.floor((np.asarray(lat) + 90) / size).astype(np.int64)
    j = np.floor((np.asarray(lon) + 180) / size).astype(np.int64)
    ncol = int(round(360 / size))
    return i * ncol + j


def cell_center(cid, size):
    ncol = int(round(360 / size))
    i, j = np.divmod(np.asarray(cid), ncol)
    return -90 + (i + 0.5) * size, -180 + (j + 0.5) * size


def load_points():
    return pd.read_pickle(WORK / "points.pkl")


def needs_fetch(path, year=None, max_age_days=6, min_size=500):
    """Cache rule for automatic updates: fetch if missing/small, and re-fetch files of the
    current (still changing) year once they are older than `max_age_days`."""
    import datetime as _dt, time as _t
    if not path.exists() or path.stat().st_size < min_size:
        return True
    if year is not None and int(year) >= _dt.date.today().year:
        return (_t.time() - path.stat().st_mtime) > max_age_days * 86400
    return False
