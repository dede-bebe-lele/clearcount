/* Guided story: walks a first-time visitor (or a judge) through the main findings. */
(() => {
  const STEPS = [
    { go: ["kz", null, "responder"], el: "rawChart",
      t: { en: "1 · The record breaks", ru: "1 · Ряд ломается", kk: "1 · Қатар үзіледі" },
      x: { en: "Raw NASA FIRMS hotspots over Kazakhstan, all satellites summed (dashed). When VIIRS joins in 2012, the count jumps <b>4.6×</b> while nothing changed on the ground. Suomi NPP stopped on 2 Nov 2026 and MODIS ends in 2027. Without harmonization, 25 years of fire history stop being comparable.",
           ru: "Сырые хотспоты NASA FIRMS по Казахстану, все спутники вместе (пунктир). Когда в 2012 году добавляется VIIRS, счёт прыгает в <b>4,6 раза</b>, хотя на земле ничего не изменилось. Suomi NPP отключён 2 ноября 2026, MODIS выключат в 2027. Без гармонизации 25 лет истории пожаров нельзя сравнивать.",
           kk: "Қазақстан бойынша NASA FIRMS шикі ыстық нүктелері (пунктир). 2012 жылы VIIRS қосылғанда сан <b>4,6 есе</b> секіреді, ал жерде ештеңе өзгерген жоқ. Suomi NPP 2026 жылғы 2 қарашада тоқтады, MODIS 2027 жылы тоқтайды." } },
    { go: ["kz", null, "responder"], el: "calendar",
      t: { en: "2 · One consistent record", ru: "2 · Один согласованный ряд", kk: "2 · Біртұтас қатар" },
      x: { en: "ClearCount converts every sensor to one scale, calibrated on the 2012–2021 overlap. The jump shrinks to <b>2%</b> (Pettitt test p = 0.74: no break). Each cell is one month, ranked against the same month in 2003–2021.",
           ru: "ClearCount переводит каждый сенсор в одну шкалу, калибруя на перекрытии 2012–2021. Скачок сжимается до <b>2%</b> (тест Петтитта p = 0,74: разрыва нет). Каждая клетка — месяц, ранжированный среди того же месяца 2003–2021.",
           kk: "ClearCount барлық сенсорды бір шкалаға келтіреді (2012–2021 қабаттасуы). Секіріс <b>2%</b>-ға дейін азаяды. Әр ұяшық — бір ай." } },
    { go: ["kz", null, "responder"], el: "trendBody", mm: "raw", mm2: "trend",
      t: { en: "Raw data gets the trend backwards", ru: "Сырые данные врут о тренде", kk: "Шикі дерек трендті бұрмалайды" },
      x: { en: "Are fires in Kazakhstan increasing? Raw NASA FIRMS says <b>yes, +5.6% a year</b>. The map first shows that raw-data trend, then switches to ClearCount: fires are <b>falling 8.5% a year</b> (Mann–Kendall p < 0.001), significantly in 238 of 346 areas. This matches published steppe studies. Without harmonization, the main conclusion would be wrong.",
           ru: "Растут ли пожары в Казахстане? Сырой NASA FIRMS говорит: <b>да, +5,6% в год</b>. Карта сначала показывает тренд сырых данных, потом переключается на ClearCount: пожары <b>снижаются на 8,5% в год</b> (Манн–Кендалл, p < 0,001), значимо в 238 из 346 районов. Это совпадает с опубликованными исследованиями степей. Без гармонизации главный вывод был бы неверным.",
           kk: "Шикі FIRMS: өрт <b>жылына +5,6%</b> өседі. ClearCount: <b>жылына 8,5% азаяды</b> (p < 0,001), 346 аймақтың 238-інде. Гармонизациясыз басты қорытынды қате болар еді." } },
    { go: ["abai", "2023-06", "responder"], el: "nowCard",
      t: { en: "3 · Abai, June 2023", ru: "3 · Абай, июнь 2023", kk: "3 · Абай, 2023 маусым" },
      x: { en: "The Semey Ormany fire killed 14 forestry workers. In the harmonized record, June 2023 in this area was <b>32× the median</b> and higher than every June since 2003. It is the #1 fire event of 430 here.",
           ru: "Пожар в Семей Орманы унёс жизни 14 лесников. В согласованном ряду июнь 2023 года здесь — <b>32 медианы</b>, выше любого июня с 2003 года. Это пожар №1 из 430 в этом районе.",
           kk: "Семей орманы өртінде 14 орманшы қаза тапты. 2023 жылғы маусым бұл жерде <b>медианадан 32 есе</b> жоғары." } },
    { go: ["abai", "2023-06", "responder"], el: "dayCard",
      t: { en: "4 · Blind or quiet?", ru: "4 · Слепота или тишина?", kk: "4 · Соқырлық па, тыныштық па?" },
      x: { en: "On 10 June hotspots dropped to <b>zero</b>. Checking every satellite pass shows both causes. The daytime passes were 69–100% cloud, so the satellites were <b>blind</b>. At night the sky was clear and the fire had <b>quietened</b> under 2.9 mm of rain. The map shows NASA's real image of that day. A raw feed says \"0\" for both. ClearCount tells them apart.",
           ru: "10 июня хотспоты упали до <b>нуля</b>. Проверка каждого пролёта показывает обе причины. Днём облачность была 69–100%: спутники были <b>слепы</b>. Ночью небо прояснилось, а огонь действительно <b>утих</b> под дождём 2,9 мм. На карте — настоящий снимок NASA этого дня. Сырой поток показывает «0» в обоих случаях. ClearCount их различает.",
           kk: "10 маусымда ыстық нүктелер <b>нөлге</b> түсті. Күндіз бұлт 69–100% болды, спутниктер <b>соқыр</b> еді. Түнде аспан ашылды, ал өрт жаңбырдан <b>басылды</b>. ClearCount екеуін ажыратады." } },
    { go: ["abai", "2023-06", "responder"], el: "wxCard",
      t: { en: "5 · Why it burned", ru: "5 · Почему горело", kk: "5 · Неге жанды" },
      x: { en: "NASA POWER weather for that month: rain <b>−36%</b>, maximum temperature <b>37.7 °C</b> (+3.4 °C above normal), humidity −6.5%. Across all years in this area, drier months burn more (ρ = −0.46).",
           ru: "Погода NASA POWER за тот месяц: дождь <b>−36%</b>, максимальная температура <b>37,7 °C</b> (на 3,4 °C выше нормы), влажность −6,5%. За все годы в этом районе сухие месяцы горят больше (ρ = −0,46).",
           kk: "NASA POWER: жаңбыр <b>−36%</b>, ең жоғары температура <b>37,7 °C</b> (+3,4 °C). Құрғақ айлар көбірек жанады." } },
    { go: ["kz", null, "scientist"], el: "driftChart",
      t: { en: "6 · Satellites drift", ru: "6 · Спутники дрейфуют", kk: "6 · Спутниктер ығысады" },
      x: { en: "Terra and Aqua no longer keep their orbits. Aqua now passes about an hour later and sees <b>+17.5%</b> more fires. Terra passes an hour earlier and sees <b>−33.9%</b>. The NOAA-20 control stays within ±5%. The orbit changed these counts, not the fires, so ClearCount stops trusting MODIS after 2021.",
           ru: "Terra и Aqua больше не держат орбиту. Aqua теперь пролетает примерно на час позже и видит на <b>17,5%</b> больше пожаров. Terra пролетает на час раньше и видит на <b>33,9%</b> меньше. Контроль NOAA-20 остаётся в пределах ±5%. Эти счёты изменила орбита, а не пожары, поэтому ClearCount не доверяет MODIS после 2021 года.",
           kk: "Aqua бір сағат кеш өтеді: <b>+17,5%</b>. Terra бір сағат ерте: <b>−33,9%</b>. Бақылау NOAA-20 ±5%. Санды өрт емес, орбита өзгертті." } },
    { go: ["kz", "2019-07", "responder"], el: "mlCard",
      t: { en: "7 · Early warning", ru: "7 · Раннее предупреждение", kk: "7 · Ерте ескерту" },
      x: { en: "Our own machine-learning model predicts, a month ahead, which areas will have an above-normal fire month. It was tested on every year it never saw: AUC <b>0.72</b>. Its top-risk areas were right 2.3× more often than chance. Lightning fires like Abai stay hard to predict, and the card says so.",
           ru: "Наша ML-модель за месяц предсказывает, где месяц будет пожарнее нормы. Проверена на каждом году, которого не видела: AUC <b>0,72</b>. Районы с наибольшим риском угадывались в 2,3 раза чаще случайного. Пожары от молнии вроде абайского остаются трудными для прогноза, и карточка об этом говорит.",
           kk: "ML-модель бір ай бұрын қай аймақта өрт нормадан көп болатынын болжайды: AUC <b>0,72</b>, кездейсоқтан 2,3 есе жақсы." } },
    { go: ["kz", null, "responder"], el: "calendar", validation: true,
      t: { en: "8 · After MODIS, and the proof", ru: "8 · После MODIS, и доказательства", kk: "8 · MODIS-тен кейін" },
      x: { en: "When Suomi NPP died, NOAA-20 took over within <b>0.1%</b>. Checked against NASA burned-area maps, raw hotspots per km² jump 8.2× after 2012 and ClearCount stays flat. All numbers are on the Validation page, including the weak ones.",
           ru: "Когда Suomi NPP отключился, NOAA-20 подхватил ряд с расхождением <b>0,1%</b>. Сверка с картами гарей NASA: сырые хотспоты на км² после 2012 года прыгают в 8,2 раза, а ClearCount остаётся ровным. Все цифры, включая слабые, — на странице «Валидация».",
           kk: "Suomi NPP тоқтағанда NOAA-20 <b>0,1%</b> дәлдікпен жалғастырды. NASA күйік аймақтарымен тексеру: шикі сан 8,2 есе секіреді, ClearCount — тегіс." } },
  ];
  let i = 0, box = null, seq = 0;
  const L = () => (window.CC ? window.CC.lang() : "en");
  const ui = { en: ["Back", "Next", "Finish", "Close tour"], ru: ["Назад", "Далее", "Готово", "Закрыть тур"], kk: ["Артқа", "Әрі қарай", "Дайын", "Жабу"] };
  function clearFocus() { document.querySelectorAll(".story-focus").forEach((e) => e.classList.remove("story-focus")); }
  function show(k) {
    i = Math.max(0, Math.min(STEPS.length - 1, k));
    const s = STEPS[i], lang = L(), u = ui[lang] || ui.en;
    window.CC.go(...s.go);
    if (window.CC.setMapMode) { window.CC.setMapMode(s.mm || "month"); if (s.mm2) setTimeout(() => { if (STEPS[i] === s && box) window.CC.setMapMode(s.mm2); }, 3200); }
    clearFocus();
    const tok = ++seq;
    setTimeout(() => {
      if (tok !== seq || !box) return;
      const el = document.getElementById(s.el); const sec = el && (el.closest("section") || el);
      if (sec) { sec.classList.add("story-focus"); sec.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); }
    }, 700);
    box.innerHTML = `<div class="story-top"><span class="tag">${i + 1} / ${STEPS.length}</span><button class="icon-btn" data-a="close" aria-label="${u[3]}">✕</button></div>
      <h3>${(s.t[lang] || s.t.en).replace(/^\d+ · /, "")}</h3><p>${s.x[lang] || s.x.en}</p>
      <div class="story-dots">${STEPS.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
      ${s.validation ? `<p><button class="btn ghost" data-a="val">Open the Validation page</button></p>` : ""}<div class="story-nav"><button class="btn ghost" data-a="prev" ${i === 0 ? "disabled" : ""}>${u[0]}</button><button class="btn" data-a="next">${i === STEPS.length - 1 ? u[2] : u[1]}</button></div>`;
    box.querySelector('[data-a="next"]').focus({ preventScroll: true });
  }
  function close() { if (box) box.remove(); box = null; clearFocus(); document.removeEventListener("keydown", keys); }
  function keys(e) { if (!box) return; if (e.key === "Escape") close(); if (e.key === "ArrowRight") show(i + 1); if (e.key === "ArrowLeft") show(i - 1); }
  function open(start) {
    if (!window.CC) return;
    if (!box) {
      box = document.createElement("aside"); box.className = "story"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Guided story");
      box.addEventListener("click", (e) => { const a = e.target.closest("[data-a]"); if (!a) return; const k = a.dataset.a; if (k === "close") close(); if (k === "val") { close(); window.CC.openValidation(); } if (k === "prev") show(i - 1); if (k === "next") { if (i === STEPS.length - 1) close(); else show(i + 1); } });
      document.body.appendChild(box); document.addEventListener("keydown", keys);
    }
    show(typeof start === "number" ? start : 0);
  }
  window.Story = { init() { const b = document.getElementById("btnStory"); if (b) b.addEventListener("click", () => open(0)); const b2 = document.getElementById("btnStory2"); if (b2) b2.addEventListener("click", () => open(0)); if (location.hash.includes("story")) open(); }, open };
})();
