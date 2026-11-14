// Static content: presets, official reported figures, About page.
window.PRESETS = [
  { id: "kz", name: { en: "Kazakhstan (whole country)", ru: "Казахстан (вся страна)", kk: "Қазақстан (бүкіл ел)" }, bbox: [40.5, 46.4, 55.5, 87.4] },
  { id: "abai", case: { month: "2023-06" }, name: { en: "★ Case: Abai fire, June 2023 (Semey Ormany)", ru: "★ Кейс: пожар в Абайской обл., июнь 2023", kk: "★ Кейс: Абай облысы өрті, 2023 маусым" }, bbox: [49.8, 78.8, 51.3, 81.8] },
  { id: "bayanaul", case: { month: "2024-10" }, name: { en: "★ Case: Bayanaul steppe fire, Oct 2024", ru: "★ Кейс: степной пожар в Баянауле, окт 2024", kk: "★ Кейс: Баянауыл дала өрті, 2024 қазан" }, bbox: [49.6, 74.6, 51.3, 76.8] },
  { id: "west", name: { en: "West: Atyrau / Tengiz (gas flares)", ru: "Запад: Атырау / Тенгиз (факелы)", kk: "Батыс: Атырау / Теңіз (алаулар)" }, bbox: [45.3, 50.8, 47.8, 55.0] },
  { id: "north", name: { en: "North: Kostanay–Akmola cropland & steppe", ru: "Север: Костанай–Акмола (поля и степь)", kk: "Солтүстік: Қостанай–Ақмола" }, bbox: [50.5, 61.0, 54.8, 72.5] },
  { id: "central", name: { en: "Central: Karaganda–Ulytau steppe", ru: "Центр: Караганда–Улытау (степь)", kk: "Орталық: Қарағанды–Ұлытау" }, bbox: [46.0, 64.5, 50.5, 76.0] },
  { id: "south", name: { en: "South: Syr Darya / Turkestan", ru: "Юг: Сырдарья / Туркестан", kk: "Оңтүстік: Сырдария / Түркістан" }, bbox: [41.0, 63.5, 45.5, 72.5] },
];

// Official / reported figures for Kazakhstan (national, partial). Sources in research/03_users.md.
window.REPORTED = [
  { period: "2023 (Abai, 8–20 Jun)", what: { en: "Semey Ormany fire: 14–15 forestry workers died, ~43–60 thousand ha burned", ru: "Пожар Семей Орманы: погибли 14–15 лесников, сгорело ~43–60 тыс. га", kk: "Семей орманы өрті: 14–15 орманшы қаза тапты, ~43–60 мың га" }, src: "https://en.wikipedia.org/wiki/2023_Kazakhstan_wildfires", d0: "2023-06-08", d1: "2023-06-20", bbox: [49.8, 78.8, 51.3, 81.8] },
  { period: "2024 (1 Jan–14 May)", what: { en: "27 forest fires and 122 steppe fires (Emergency Ministry)", ru: "27 лесных и 122 степных пожара (МЧС)", kk: "27 орман және 122 дала өрті (ТЖМ)" }, src: "https://qazinform.com/news/kazakhstan-records-almost-30-early-wildfires-this-season-3f455e", d0: "2024-01-01", d1: "2024-05-14" },
  { period: "2024 (Oct, Bayanaul)", what: { en: "Steppe fire grew to ~6,000 ha in one day; 1 firefighter died", ru: "Степной пожар ~6000 га за сутки; погиб 1 пожарный", kk: "Бір күнде ~6000 га дала өрті; 1 өрт сөндіруші қаза тапты" }, src: "https://en.tengrinews.kz/emergencies/large-steppe-fire-in-kazakhstan-new-details-264417", d0: "2024-10-01", d1: "2024-10-31", bbox: [49.6, 74.6, 51.3, 76.8] },
  { period: "2025 (to mid-April)", what: { en: "34 forest fires and 405 dry-vegetation fires; season opened 26 Mar (S, W), 7 Apr (centre), 14 Apr (E)", ru: "34 лесных и 405 пожаров сухой растительности; сезон открыт 26 марта (юг, запад), 7 апреля (центр), 14 апреля (восток)", kk: "34 орман және 405 құрғақ шөп өрті" }, src: "https://bizmedia.kz/2025-04-16-pozhary-v-kazahstane-v-minekologii-gotovyatsya-k-letnemu-sezonu/", d0: "2025-01-01", d1: "2025-04-15" },
  { period: "2025 (season)", what: { en: "609 forest fires on 62.7 thousand ha of state forest fund (Kazinform, 10 Nov 2025)", ru: "609 лесных пожаров на 62,7 тыс. га гослесфонда (Казинформ, 10 нояб. 2025)", kk: "609 орман өрті, 62,7 мың га мемлекеттік орман қорында (Kazinform, 10.11.2025)" }, src: "https://www.inform.kz/ru/bolee-600-lesnih-pozharov-proizoshlo-v-kazahstane-s-nachala-goda-f10dde", d0: "2025-01-01", d1: "2025-11-10" },
];

// About page text lives in content_about.js
