// About page (EN full; RU full; KZ falls back to EN until reviewed by a native speaker).
window.ABOUT = {};
window.ABOUT.en = `
<h3>The problem</h3>
<p>For 25 years, NASA satellites have recorded every fire hotspot on Earth. The record is split across sensors that see differently.</p>
<ul>
<li><strong>MODIS</strong> (Terra 2000–, Aqua 2002–) uses 1 km pixels.</li>
<li><strong>VIIRS</strong> (S-NPP 2012–2026, NOAA-20 2018–, NOAA-21 2023–) uses 375 m pixels and finds about <strong>5×</strong> more hotspots.</li>
</ul>
<p>Add the sensors up and fire activity "jumps" whenever a satellite joins, although nothing changed on the ground. The record is breaking right now: <strong>Suomi NPP stopped on 2 Nov 2026 and MODIS ends in 2027.</strong></p>
<p>A hotspot file also cannot say "the satellite could not see". Under clouds a burning fire produces zero hotspots, the same as no fire at all.</p>

<h3>What ClearCount does</h3>
<ol>
<li><strong>Harmonizes</strong> every sensor into one scale (MODIS-Aqua-equivalent hotspots), so the sensor of origin no longer matters.</li>
<li><strong>Removes persistent industrial sources:</strong> gas flares at Tengiz, Karachaganak and Zhanazhol, and plants. This is 17% of all detections in Kazakhstan, many of them labelled as vegetation fires.</li>
<li>Builds a <strong>burning calendar</strong> for any drawn area or coordinates, 2000 → today. Each month is ranked against the median of the same month in 2003–2021.</li>
<li><strong>Tells blind from quiet:</strong> cloud cover, satellite passes, per-pass fire masks and the real satellite image of the day.</li>
<li>Explains and anticipates:
  <ul>
  <li>fire weather;</li>
  <li>what burns (steppe, cropland, forest);</li>
  <li>a season outlook;</li>
  <li>a machine-learning early warning a month ahead.</li>
  </ul></li>
</ol>

<h3>Why Kazakhstan</h3>
<ul>
<li>Kazakh steppes are <strong>47% of all burned area in Northern Eurasia</strong> (Hao et al. 2021). Yet we found no study of VIIRS hotspots or of the MODIS/VIIRS ratio for Kazakhstan.</li>
<li>In June 2023 the <strong>Abai region fire killed 14 forestry workers</strong>.</li>
<li>Official geoservices are closed to the public.</li>
</ul>
<p>Kazakhstan is our proving ground. The same calibration, applied unchanged to <strong>Mongolia</strong>, reaches R² 0.81 against Mongolia's own MODIS record.</p>

<h3>Method</h3>
<ul>
<li><strong>Reference scale: MODIS Aqua</strong>, the convention INPE and GWIS also use.</li>
<li><strong>Bridges and calibration:</strong>
  <ul>
  <li>Terra-only months (2000–02) are bridged with Aqua/Terra ratios.</li>
  <li>From 2012, VIIRS S-NPP is converted with ratios calibrated on the clean 2012–2021 overlap, when both crossed at about 13:30, before orbit drift.</li>
  <li>The ratios are hierarchical and shrunken (country → 3° block → season, each split by day/night).</li>
  </ul></li>
<li><strong>Continuity:</strong> from 10 Jul 2026, when S-NPP became non-nominal, NOAA-20 carries the record via its 2018–2025 overlap with S-NPP. The simulated switch differs by 0.1%.</li>
<li><strong>Baseline:</strong> 2003–2021, fixed before the Terra/Aqua orbit drift.</li>
<li><strong>Blindness:</strong>
  <ul>
  <li>daily cloud amount (NASA POWER, CERES SYN1deg);</li>
  <li>satellite passes counted from 370,000 FIRMS swath outlines (NASA CMR);</li>
  <li>for case studies, every MODIS pass checked with Level-2 fire masks and geolocation.</li>
  </ul></li>
<li><strong>Events:</strong> hotspots within about 2 km and 1 day are linked into fires. Size is given in harmonized hotspots.</li>
<li><strong>Early warning:</strong> gradient-boosted trees on lagged fire activity and NASA POWER weather anomalies. Every year is predicted by a model that never saw it.</li>
</ul>

<h3>Findings</h3>
<ul>
<li><strong>The 2012 jump disappears:</strong> ×4.6 in the raw sum, 2% in ClearCount.</li>
<li><strong>Burned-area check (MCD64A1):</strong> raw hotspots per km² burned rise ×8.2 after 2012; ClearCount changes +14%.</li>
<li><strong>Why VIIRS sees 5.3× more:</strong> 1.29× more satellite looks × 4.09× more detections per look.</li>
<li><strong>Orbit drift:</strong> Aqua (crossing ~1 h later) +17.6%, Terra (~1 h earlier) −33.8%, NOAA-20 control ±5%.</li>
<li><strong>Abai, 10 Jun 2023:</strong> the satellites were blind by day (69–100% cloud). The fire was quiet by night, under 2.9 mm of rain.</li>
</ul>

<h3>NASA data (all open)</h3>
<ul>
<li>FIRMS active fire: MODIS C6.1 (Terra/Aqua) and VIIRS 375 m (S-NPP, NOAA-20, NOAA-21), standard processing and NRT</li>
<li>FIRMS satellite swath outlines: Level-2 granule footprints from NASA CMR (MOD14, MYD14, VNP14IMG, VJ114IMG, VJ214IMG)</li>
<li>NASA GIBS / Worldview corrected-reflectance true colour</li>
<li>NASA POWER: daily CERES SYN1deg cloud amount; monthly MERRA-2 precipitation, temperature, humidity, wind</li>
<li>MOD14A1 / MYD14A1 / VNP14A1 / VJ114A1 daily fire masks</li>
<li>MOD14 / MYD14 Level-2 fire masks with MOD03 / MYD03 geolocation</li>
<li>MCD12Q1 land cover (2020)</li>
<li>MCD64A1 burned area</li>
<li>Other: Kazakhstan boundary from geoBoundaries (CC BY 4.0); basemap © Esri, © OpenStreetMap</li>
</ul>

<h3>Limitations</h3>
<ul>
<li>Ratios are calibrated per region, season and day/night. Biomes very different from steppe should be recalibrated on their own overlap (the pipeline does this for any FIRMS country).</li>
<li>The daily cloud layer is a 1° proxy. Exact per-pass checks are available for the case studies.</li>
<li>NASA CERES cloud data lags about 3 months.</li>
<li>Hotspots are not burned area. Small, short-lived and understory fires are missed by every sensor.</li>
<li>Lightning ignitions are not predictable a month ahead.</li>
</ul>

<h3>Key references</h3>
<ul>
<li>Giglio et al. 2006 (cloud-corrected MODIS counts)</li>
<li>Schroeder et al. 2014 (VIIRS 375 m)</li>
<li>Fu et al. 2020, Remote Sensing 12:2870</li>
<li>Sofiev &amp; Kouznetsov 2026, GMD 19:10123</li>
<li>Zheng et al. 2026, Remote Sensing 18:1650</li>
<li>Chen et al. 2026, ESSD 18:7535 (GFED5NRT)</li>
<li>Hao et al. 2021, Biogeosciences 18:2559</li>
<li>Giglio, LANCE UWG 2025 (orbit drift)</li>
<li>INPE Programa Queimadas</li>
</ul>

<h3>Cite and reuse</h3>
<p>ClearCount team (2026). <em>ClearCount: a harmonized MODIS–VIIRS burning-activity calendar for Kazakhstan, 2000–2026</em>. NASA Space Apps Challenge 2026. Data derived from NASA FIRMS, POWER, GIBS, CMR and LP DAAC products.</p>
<pre style="white-space:pre-wrap;font-size:11.5px;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:10px">@misc{clearcount2026,
  title  = {ClearCount: a harmonized MODIS--VIIRS burning-activity calendar for Kazakhstan, 2000--2026},
  author = {{ClearCount team}},
  year   = {2026},
  note   = {NASA Space Apps Challenge 2026; data: NASA FIRMS, POWER, GIBS, CMR, LP DAAC}
}</pre>
<p>Derived data (calendars, events, trends) may be reused with attribution to ClearCount and NASA FIRMS. NASA data are open: please acknowledge FIRMS as NASA asks: "We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS)."</p>

<h3>Use of AI</h3>
<p>AI assistants helped search the literature, write and debug code, and draft text and translations. Every number in the app comes from running the open pipeline on NASA data. The code, method and validation are published for anyone to check.</p>
<p class="muted">ClearCount is an independent project. It is not endorsed by NASA.</p>`;

window.ABOUT.ru = `
<h3>Проблема</h3>
<p>25 лет спутники NASA фиксируют каждую горячую точку на Земле. Но запись разделена между сенсорами, которые видят по-разному.</p>
<ul>
<li><strong>MODIS</strong> (с 2000 года) работает с пикселем 1 км.</li>
<li><strong>VIIRS</strong> (с 2012 года) работает с пикселем 375 м и находит примерно в <strong>5 раз</strong> больше точек.</li>
</ul>
<p>Если просто сложить данные, активность «прыгает» каждый раз, когда подключается новый спутник, хотя на земле ничего не изменилось. Ряд ломается прямо сейчас: <strong>Suomi NPP отключён 2 ноября 2026 года, MODIS выключат в 2027-м.</strong></p>
<p>Кроме того, под облаками горящий пожар даёт ноль точек, ровно как отсутствие пожара.</p>

<h3>Что делает ClearCount</h3>
<ol>
<li><strong>Сводит</strong> все сенсоры в одну шкалу, так что сенсор-источник больше не важен.</li>
<li><strong>Убирает газовые факелы и промышленность</strong> (Тенгиз, Карачаганак, Жанажол) — это 17% всех точек.</li>
<li>Строит <strong>календарь горения</strong> для любой области с 2000 года по сегодня. Каждый месяц ранжируется относительно медианы того же месяца за 2003–2021.</li>
<li><strong>Отличает «слепоту» от «тишины»:</strong> облачность, пролёты спутников, маски каждого пролёта и снимок дня.</li>
<li>Объясняет и предупреждает:
  <ul>
  <li>пожарная погода;</li>
  <li>что горит (степь, поля, лес);</li>
  <li>прогноз сезона;</li>
  <li>ML-предупреждение за месяц.</li>
  </ul></li>
</ol>

<h3>Почему Казахстан</h3>
<ul>
<li>Казахские степи — это <strong>47% всей площади гарей Северной Евразии</strong>. При этом исследований VIIRS и соотношения MODIS/VIIRS по Казахстану мы не нашли.</li>
<li>В июне 2023 года в <strong>пожаре в области Абай погибли 14 лесников</strong>.</li>
<li>Государственные геосервисы закрыты для публики.</li>
</ul>
<p>Те же коэффициенты без изменений работают в <strong>Монголии</strong>: R² 0,81.</p>

<h3>Главные результаты</h3>
<ul>
<li><strong>Скачок 2012 года:</strong> в сырой сумме ×4,6, в ClearCount 2%.</li>
<li><strong>Сверка с картами гарей NASA:</strong> сырой ряд ×8,2, ClearCount +14%.</li>
<li><strong>Почему VIIRS видит в 5,3 раза больше:</strong> 1,29× больше пролётов × 4,09× больше находок за пролёт.</li>
<li><strong>Дрейф орбит:</strong> Aqua +17,6%, Terra −33,8%, контроль NOAA-20 ±5%.</li>
<li><strong>Абай, 10 июня 2023:</strong> днём спутники были слепы (69–100% облаков), а ночью огонь утих под дождём 2,9 мм.</li>
</ul>

<h3>Данные NASA</h3>
<p>FIRMS (MODIS, VIIRS S-NPP / NOAA-20 / NOAA-21; полосы обзора через CMR), GIBS / Worldview, POWER (облачность CERES, погода MERRA-2), MOD14A1 / MYD14A1 / VNP14A1 / VJ114A1, MOD14 / MYD14 L2 + MOD03 / MYD03, MCD12Q1, MCD64A1. Граница страны — geoBoundaries (CC BY 4.0).</p>

<h3>Ограничения</h3>
<ul>
<li>Коэффициенты региональные: для других биомов пайплайн перекалибруется сам.</li>
<li>Слой облачности грубый (1°), а для кейсов есть точная проверка каждого пролёта.</li>
<li>Данные облачности CERES приходят с задержкой примерно 3 месяца.</li>
<li>Хотспоты — это не площадь гари.</li>
<li>Пожары от молний нельзя предсказать за месяц.</li>
</ul>

<h3>Использование ИИ</h3>
<p>ИИ-ассистенты помогали с поиском литературы, кодом, текстами и переводами. Все цифры получены запуском открытого пайплайна на данных NASA.</p>`;

window.ABOUT.kk = window.ABOUT.en;
