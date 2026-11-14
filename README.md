# ClearCount — Zero hotspots isn't zero fire

**A harmonized MODIS + VIIRS burning-activity calendar, from 2000 to today, that also tells you when the satellites were blind.**
Built for the NASA Space Apps challenge *"Harmonization of MODIS and VIIRS Hot Spots"*. Validated on Kazakhstan.

## The problem

- **Sensors see fires differently.** VIIRS (375 m) detects about **5× more daytime and 20× more night-time hotspots** than MODIS over Kazakhstan (our measurement).
  - When the sensors are simply added up, the record jumps **4.6×** in 2012, the year VIIRS arrived.
  - Nothing changed on the ground.
- **The record is breaking right now.**
  - Suomi NPP stopped delivering data on **2 Nov 2026**.
  - MODIS ends in 2027.
- **Hotspot files don't record what the satellites could not see.**
  - Under clouds, a fire produces *zero* hotspots, which looks like *no fire*.

## What ClearCount does
1. **Harmonizes** FIRMS hotspots into one unit (MODIS-Aqua-equivalent hotspots):
   - Terra → Aqua bridge (2000–2002);
   - Aqua (2002–2011);
   - VIIRS S-NPP converted to Aqua units (2012–);
   - NOAA-20 chained in to replace S-NPP.
2. **Calibrates on the clean overlap** (2012–2021, both satellites crossing at ~13:30, before Aqua's orbit drift).
   - Uses hierarchical, shrunken ratios: country → 3° block → season, each split by day/night.
3. **Masks persistent industrial sources** (gas flares, plants): FIRMS type 2, plus our own multi-year persistence rule.
   - This removes **15.8%** of all detections in Kazakhstan, including Tengiz, Karachaganak and Zhanazhol.
   - Many of these sites carry the FIRMS `type 0` (vegetation) flag.
4. **Burning calendar** (months × years, 0.25° grid), for any drawn polygon, rectangle or lat/lon box:
   - percentile rank against the same month in 2003–2021;
   - ×median and anomaly vs mean;
   - accessible blue–grey–orange ramp.
5. **Blindness layer.** Months with ≥60% of days at ≥70% cloud (NASA POWER, CERES SYN1deg) are hatched.
   - The **day-by-day** view flags days when hotspots collapse under cloud between active days ("blind, not quiet").
6. **Fire events.** Hotspots are linked within ~2 km and 1 day; event size is in harmonized hotspots.
   - "How does this fire compare with previous ones?" becomes a rank.
7. **Also included:**
   - "Now" card, records, season clock (onset / midpoint / end and their trend), detected-vs-reported table;
   - CSV export (calendar and points), PNG export, PDF report;
   - EN / RU / KZ; three user modes (Responder / Scientist / Land manager);
   - dark and light themes, mobile layout, keyboard navigation of the calendar, table view.

## New findings (Kazakhstan)
- **Orbit-drift detector**, relative to VIIRS S-NPP (maintained orbit), with a 2012–2019 baseline and 95% bootstrap CIs:
  - Aqua's median local detection time moved from 12:59 to **14:02**, and its daytime fire counts rose **+17.5%** by 2025;
  - Terra moved from 11:12 to **10:10**, and its counts fell **−33.9%**;
  - the NOAA-20 placebo stays within ±5%;
  - the opposite signs match the afternoon fire peak.
- **Why VIIRS sees 5.3× more** (from 333,184 FIRMS swath outlines / CMR granules): 1.29× more satellite looks (wider swath) × 4.09× more detections per look.
- **Blind *or* quiet? Checked pass by pass** (Level-2 MYD14/MOD14 fire masks + MYD03/MOD03 geolocation, Earthdata).
  - Evening of 9 Jun to midday 10 Jun 2023: every MODIS pass over the Abai fire zone was **69–100% cloud** with 0 fire pixels, so the satellites were **blind**.
  - Night of 10 Jun: passes were **clear** and still showed **0** fire pixels. The fire had quietened under 2.9 mm of rain (RH 69%, against 33% on 7–8 Jun).
  - 11 Jun: 19–36 fire pixels again.
  - The daily L3 composites (MxD14A1/VNP14A1) cannot show this, because a pixel counts as "clear" if any pass that day was clear.
- **Day-by-day view, with a picture:**
  - on 10 Jun 2023 the satellites passed over the Abai fire area 13 times, but only ~3 passes were clear;
  - hotspots fell to 0 between 39 (9 Jun) and 56 (11 Jun);
  - the NASA GIBS true-colour image of that day shows the cloud deck.

## Harmonization makes the ML better (`21_ml_raw_vs_harmonized.py`)
Same model, same weather, same target; only the fire-history features differ. Leave-one-year-out, 2003–2026.

| Features | AUC | PR-AUC | Top-10% hit rate | Brier skill vs climatology |
|---|---|---|---|---|
| Raw FIRMS history | 0.678 | 0.317 | 36% | 5.3% |
| **ClearCount history** | **0.724** | **0.401** | **48%** | **10.6%** |

## Independent validation against NASA burned area (MCD64A1, Apr–Oct)
Hotspots per 100 km² of burned area:

| | 2008 | 2010 | 2015 | 2017 | 2019 | 2021 | 2023 |
|---|---|---|---|---|---|---|---|
| raw FIRMS sum | 25 | 28 | 130 | 150 | 290 | 251 | 272 |
| **ClearCount** | **12.5** | **13.9** | **14.4** | **15.9** | **17.2** | **15.5** | **12.2** |

- Raw: ×8.2 after 2012.
- ClearCount: +14%, within year-to-year variation.

## How much fire did clouds hide? (`23_blind_correction.py`)
- **Method:** Poisson gradient boosting trained on clear days (cloud < 40%), applied to cloud-blind days (≥ 70%).
  - Predictors: activity on the surrounding days, daily rain (NASA POWER), satellite passes (FIRMS swath outlines), season, and the cell's climatology.
- **Artificial-blinding test** (clear days 2019–2025 hidden and re-estimated):
  - R² (log) 0.42, vs 0.37 for naive interpolation;
  - total bias +8.6%, calibrated out.
- **Results:**
  - 32% of fire-season days are cloud-blind;
  - clouds hid ≈22% of fire-season hotspots (13–24% across model variants);
  - **the decline survives the correction:** −8.7%/yr observed, −8.3%/yr corrected, both p < 0.001.

## Trends: the raw data gets them backwards (`19_trends_regimes.py`)
- **Method:** Mann–Kendall test + Sen's slope per 1° cell, 2003–2025, Benjamini–Hochberg FDR (q = 0.10).

| Kazakhstan | Significantly up | Significantly down | National trend |
|---|---|---|---|
| Raw FIRMS sum | 50 cells | 7 cells | **+5.6%/yr** |
| **ClearCount** | 5 cells | **238 cells** | **−8.5%/yr (p < 0.001)** |

- The harmonized result matches published studies of declining Kazakh steppe fires (Hao et al. 2021).

## Fire regimes (unsupervised ML)
- **Method:** k-means (k = 3, chosen by silhouette score) on the seasonal profile, activity level, variability, cropland share and night share. The algorithm is given no geography.
- **Regimes found:**
  - steppe and grassland, peak Jul–Aug (190 cells);
  - mixed cropland and steppe, peak Mar–Apr (46 cells);
  - mixed cropland and steppe with two peaks, Apr + Oct (110 cells, the grain belt).

## Calibration uncertainty (`18_uncertainty.py`)
- **Method:** 1000 bootstrap resamples of the calibration days.
- **95% interval of the harmonized monthly count:**
  - **±3.1%** in the VIIRS era;
  - ±2.7% for the Terra bridge;
  - 0 for the Aqua reference era.
- **In the app:** shown as a band on the "Raw vs ClearCount" chart and as a range in the "Now" card.

## Transfer test: Mongolia (`17_transfer_mongolia.py`)
Kazakhstan-trained ratios were applied unchanged to Mongolia's S-NPP hotspots and compared with Mongolia's own MODIS Aqua record (2012–2021, 1° block-months).

| Method | Period | R² (log) | Bias |
|---|---|---|---|
| Kazakhstan ratios | 2012–2021 | **0.81** | **+8%** |
| Naive single ratio | 2012–2021 | 0.76 | +37% |
| Kazakhstan ratios | 2018–21 | 0.68 | — |
| Mongolia's own in-country calibration | 2018–21 | 0.69 | — |

## What burns (MCD12Q1 land cover)
- 83% of harmonized hotspots fall in steppe, shrub and grass; 16% in cropland.
- In northern Kazakhstan, cropland fires peak in Apr–May and Sep–Oct, the stubble-burning seasons.

## Early warning (machine learning)
- **Model:** gradient-boosted trees (`13_ml_outlook.py`).
- **Question:** at the end of month t−1, will month t be above the 75th percentile for that 1° cell?
- **Inputs:** only data known before month t starts:
  - fire activity on the harmonized record (previous months, same month last year);
  - NASA POWER rain, heat, humidity and wind anomalies;
  - cloud blindness.
- **Evaluation:**
  - leave-one-year-out hindcast: **AUC 0.72**; the top 10% risk cell-months are above normal **48%** of the time vs 21% at random (×2.3);
  - strict split (train ≤2015, test 2016–25): AUC 0.66 vs 0.57 for persistence.
- **Main drivers:** usual activity, last month's fire anomaly, rain over the last 6 months.
- **Limitation:** lightning fires such as Abai 2023 are not predictable a month ahead. The app shows this honestly.

## Validation (Kazakhstan; test years never used for fitting)

| Test | Result |
|---|---|
| VIIRS S-NPP → Aqua, train 2012–17, **test 2018–21**: R² (log, block-months) | **0.915** (naive single ratio: 0.895) |
| Total bias vs observed Aqua (test) | **−1.8 %** |
| Cohen's κ, "month above p90" (test) | **0.68** (naive: 0.64) |
| Step at Jan 2012 (median log-ratio to Aqua) | raw sum **1.52** (×4.6) → ClearCount **0.02** |
| Pettitt change-point test, 2006–2017 | raw: p < 0.001 (break at 2012-03) → ClearCount: p = 0.76 (no break) |
| NOAA-20 → S-NPP handover, test 2024–25: R² (log) / bias | **0.889 / +0.7 %** |
| Simulated loss of S-NPP (NOAA-20 chain ÷ S-NPP chain, 2024–25) | **0.989** (monthly Spearman 0.992) |
| Terra → Aqua bridge, test 2009–11: R² (log) / bias | 0.812 / −1.3 % |
| Case: Abai fire, June 2023 | Event #1 of 430 in the area (starts 8 Jun, 8 days); June 2023 = **32× median**, percentile 100; **10 Jun: 0 hotspots between 39 (9 Jun) and 56 (11 Jun) under ≥70 % cloud** (matches Kazakhstan Gharysh Sapary's report that clouds hid most hotspots on 10 June) |

Ratios (national, 2012–2021): Aqua/S-NPP = 0.190 by day and 0.048 by night.

## Automatic updates
- **Mechanism:** a scheduled GitHub Actions workflow (`.github/workflows/update.yml`) runs `pipeline/update.py` and publishes `web/` to GitHub Pages.
- **Schedule:**

| When | What runs |
|---|---|
| Every night | new FIRMS hotspots → harmonization, events, regions, uncertainty |
| Mondays | + NASA POWER cloud/rain/weather, satellite passes, trends, cloud-hidden correction, ML |
| 1st of the month | + Earthdata products, Mongolia transfer, raw-vs-harmonized ML |

- **Failures:** a failed step keeps the previous output, so the site never breaks.
- **Credentials:** keys live in GitHub Secrets.
- **Site stamp:** the page shows "⟳ updated …".
- **Setup:** see `GITHUB_SETUP.md`.

## Run it
```bash
cd clearcount
python3 -m venv .venv && .venv/bin/pip install pandas numpy scipy
./pipeline/01_download_firms.sh            # FIRMS SP country files (public, ~300 MB)
cd pipeline && P=../.venv/bin/python
$P 02_prepare.py && $P 03_harmonize.py && $P 04_clouds.py && $P 05_events.py && $P 06_export_web.py
$P 07_looks.py && $P 08_drift.py && cp ../data/work/drift.json ../web/data/ && $P 09_looks_export.py && $P 10_weather.py && $P 13_ml_outlook.py
# need keys (see LOGIN_SETUP.md): $P 11_firms_api.py ; $P 12_earthdata.py landcover && $P 12_earthdata.py cases && $P 12_earthdata.py burned && $P 14_case_overpass.py && $P 15_export_lc.py
# or simply: python pipeline/update.py --mode full
cd ../web && python3 -m http.server 8765   # open http://localhost:8765
```

## Data (all NASA)
- NASA FIRMS, MODIS C6.1 active fire (Terra/Aqua), standard processing — https://firms.modaps.eosdis.nasa.gov
- NASA FIRMS, VIIRS 375 m active fire, S-NPP and NOAA-20, standard processing
- NASA POWER daily `CLOUD_AMT` (CERES SYN1deg) — https://power.larc.nasa.gov
- FIRMS satellite swath outlines = Level-2 granule footprints from NASA CMR (MOD14, MYD14, VNP14IMG, VJ114IMG) — https://cmr.earthdata.nasa.gov
- NASA GIBS / Worldview corrected-reflectance true colour (MODIS Terra/Aqua, VIIRS S-NPP/NOAA-20) — https://gibs.earthdata.nasa.gov
- NASA POWER monthly MERRA-2: precipitation, max temperature, humidity, wind (fire-weather card)
- *With an Earthdata Login (scripts ready, see LOGIN_SETUP.md):* MCD12Q1 land cover, MOD14A1/MYD14A1/VNP14A1/VJ114A1 daily fire masks, MCD64A1 burned area
- *With a FIRMS MAP_KEY:* 2026 hotspots and VIIRS NOAA-21 via the FIRMS country API

## Limitations and next steps
- **v2 clear-sky layer** (needs an Earthdata Login): MOD14A1 / MYD14A1 / VNP14A1 / VJ114A1 daily fire masks, which give exact counts of clear land (class 5) and cloud (class 4) per 1 km pixel. This replaces the 1° cloud proxy.
- **2026 and NOAA-21** need the FIRMS Area API (MAP_KEY). The country files end in Dec 2025.
- **Ratios are calibrated for Kazakhstan.** Other biomes need their own overlap calibration; the pipeline takes any FIRMS country.
- **Aqua after 2021** is affected by orbit drift and is deliberately not used as a reference.
- **Hotspots are not burned area.** Small, short-lived and understory fires are missed by every sensor.

## Prior work we build on
- Giglio et al. 2006 (cloud- and overpass-corrected MODIS counts)
- Schroeder et al. 2014 (VIIRS 375 m)
- Fu et al. 2020 (MODIS–VIIRS omission)
- Sofiev & Kouznetsov 2026, GMD (observation operators)
- Zheng et al. 2026 (MYD14 + VNP14IMG fusion)
- GFED5NRT (Chen et al. 2026)
- INPE's reference-satellite approach

## Use of AI
AI assistants were used to:
- research the literature and data sources;
- generate and debug the pipeline and web code;
- draft text and translations.

The Kazakh UI strings need review by a native speaker. All numbers come from running the code on NASA data.
