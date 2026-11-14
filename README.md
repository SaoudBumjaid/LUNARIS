# LUNARIS — Land, then drive.

**NASA Space Apps Challenge 2026 · Challenge: Lunar Landing Site Navigator**
**Team Karak & Cosmos · Nasser Centre for Science & Technology (NCST), Kingdom of Bahrain**

| | |
|---|---|
| **▶ Live app** (no install, any modern browser) | https://ipo735723-afk.github.io/LUNARIS/ |
| **▶ 7-slide demo** | [docs/presentation/LUNARIS_Demo_7_Slides.pdf](docs/presentation/LUNARIS_Demo_7_Slides.pdf) |
| **Full presentation** | [docs/presentation/LUNARIS_NASA_Space_Apps_2026.pdf](docs/presentation/LUNARIS_NASA_Space_Apps_2026.pdf) |
| **Test results** | [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md) |
| **Data sources** | [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) |

> Independent student prototype. Not affiliated with or endorsed by NASA. Scores are transparent planning aids, not a landing-safety certification.

**Contents:** [English](#english) · [العربية](#arabic)

---

<a id="english"></a>
# English

## 1. The problem
Missions to the lunar south pole face extreme conditions. The Sun stays within a few degrees of the horizon, so hills cast very long shadows that move every hour. Earth is low too, so terrain often blocks the radio link. The most interesting targets — possible water ice — sit in craters that never see the Sun.
Planners need to know, for each candidate site and date: **How much sunlight is there? When is Earth in view? Is the ground safe to land on? Can a rover reach a target and come back before it runs out of power?**

## 2. Our solution
LUNARIS is an interactive web app that answers these questions on **real NASA terrain**. It follows the mission in four steps:

1. **Choose a site** — six real south-pole regions (8 × 8 km), including the **IM-2 Athena (CLPS) landing site**.
2. **Check Sun and Earth** — for any hour: Sun and Earth position against the real skyline, sunlight, solar energy and communication windows.
3. **Land safely** — slope hazards inside the whole landing ellipse, six weighted criteria with visible formulas, best landing date.
4. **Drive sun-aware** — a rover route that changes with time, avoids moving shadows and protects the battery.

Existing tools answer *"where and when is there Sun and Earth?"*. LUNARIS keeps that, and adds what a surface mission needs next: landing hazards, a time-aware rover plan with a battery model, date-versus-date comparison and What-If scenarios.

## 3. Pages of the app
| Page | What you can do |
|---|---|
| **South Pole Map** | Zoom and pan a LOLA shaded-relief map of the pole. See the six regions to scale; zoom in to see our own 40 m relief or yearly-sunlight layer. Read coordinates under the cursor. Add sites to Compare. |
| **Mission Command** | Region overview, candidate sites with scores, cold-trap targets, risks and data confidence. |
| **Lunar Explorer** | 3-D / 2-D terrain with 8 data layers, shadow animation, skyline against Sun and Earth paths. |
| **Sun & Earth** | For any site and hour: Sun and Earth azimuth/elevation, the terrain height in that direction, visible part of the Sun, Earth line of sight, which NASA Deep Space Network complexes see the Moon, a skyline panorama, sunlight and communication windows, solar energy per day. |
| **Compare Sites** | 2–4 sites from any region, **or one site on up to 4 dates**. Winner with the worked score, side-by-side bars, exact numbers, three synchronized charts and CSV export with provenance. Goals: Balanced / Power first / Earth contact first, or your own weight. |
| **Landing Safety** | Slope hazard map of the landing ellipse, six criteria with formulas, 90-day best-landing-date scan. |
| **Traverse Planner** | Shortest route vs **sun-aware** route, battery along the route, departure-window finder, report export. |
| **What If? Simulator** | Landing delay, longer shadows, Earth-link outage, blocked route, less solar power — before/after with the reason. |
| **Data & Sources** | Where every layer comes from, the methods, the checks and the limits. |

## 4. Real NASA data
| Data | Source | Use in LUNARIS |
|---|---|---|
| Terrain near each site, 20 m | NASA LRO **LOLA** south-pole DEMs (Barker et al. 2023, NASA GSFC PGDA) | slope, horizons, hazards, 3-D view |
| Terrain to 300 km, 400 m | NASA LRO **LOLA** polar elevation models | distant horizons, South Pole Map |
| Sun, Earth and Moon positions | **JPL DE421** ephemeris + IAU lunar rotation model | sunlight, Earth view, DSN geometry |
| Checking | **JPL Horizons** | independent comparison of our directions |

Every number in the app is **computed by our own code** from these data. Nothing is invented or simulated.

## 5. We checked our numbers — all PASS
| Check | Result |
|---|---|
| Sun and Earth directions vs **JPL Horizons** (8,761 hourly samples, full year) | max difference **0.003°** |
| Sunlight on real terrain vs a published study (Barker et al. 2021, Connecting Ridge, 5 m mast) | LUNARIS **89.2 %** vs published **88.1 %** |
| Moon elevation at the Goldstone DSN complex vs **JPL Horizons** (721 hours) | max difference **0.0013°**, 721/721 hours agree |
| Automated tests | 57/57 planner · 52/52 Sun & Earth engine · 25/25 browser steps (incl. phone width) |

## 6. Key result
Across **300 departure times** in 5 regions, with the same rover:
- the classic shortest-path plan brings the rover back **136** times;
- the LUNARIS sun-aware planner brings it back **193** times — **+42 %**.

Example — Malapert Massif, 15 January 2027: the shortest path falls below the 20 % battery reserve after 4.3 h; the sun-aware path is 0.9 km longer, finishes the 4.2 km trip in 14.7 h and ends with 32 % battery.

## 7. How it works
1. **Python pipeline** (`pipeline/`): computes the terrain horizon of every 40 m cell in 72 directions (with lunar curvature and a 300 km far-field scan), then hourly sunlight, Earth line of sight, slope and permanently shadowed areas for all of 2027, and the DSN view of the Moon.
2. **Web app** (`web/`, React + TypeScript): loads the prepared data and runs site scoring, comparisons and the rover planner **in the browser**.
3. **Sun-aware planner**: a time-dependent weighted A* search over *(place, hour, battery)*. Each step checks slope, sunlight at that hour and energy (solar panel × visible part of the Sun − driving power). The rover may wait to recharge or for sunrise.
4. **Communication — three levels, kept apart:** Earth line of sight (computed) → a DSN complex sees the Moon (computed) → a real link (needs a scheduled antenna, *not modelled*). So “contact possible” is an upper bound.

## 8. Run it yourself
**Easiest:** open the live app — https://ipo735723-afk.github.io/LUNARIS/

**On your computer (Windows):** install Node.js 20+ from https://nodejs.org, then double-click `START_LUNARIS.bat` (opens http://localhost:5173).
Without Node.js you can also double-click `OPEN_LUNARIS.bat` after building `web/dist`.

**Any OS:**
```bash
cd web && npm install && npm run dev          # http://localhost:5173
# optional: rebuild and re-check the data (offline)
cd pipeline && pip install -r requirements.txt
python validate_ephemeris.py && python validate_illumination.py && python build_open.py && python build_extras.py
# tests
cd web && npx tsx tests/planner_real.test.ts && npx tsx tests/sky.test.ts && npx tsx tests/departure_scan.test.ts
```

## 9. Repository structure
```
LUNARIS/
  START_LUNARIS.bat / OPEN_LUNARIS.bat   run the web app on Windows
  BUILD_REAL_DATA.bat                    re-check and rebuild the datasets
  pipeline/                              Python: ephemeris, horizons, sunlight, PSR, slope, DSN, validation
  web/                                   React + TypeScript + Vite + three.js + Recharts
    public/data/                         prepared datasets for the six regions, pole map, DSN table
    src/engine/                          illumination, Sun & Earth analysis, scoring, rover planner
    src/pages/                           the nine pages of the app
    tests/                               engine tests and automated browser tests
  docs/                                  data sources, test results, reference review, presentation
  .github/workflows/pages.yml            builds and publishes the live app to GitHub Pages
```

## 10. Limits (stated openly)
- Rocks and craters smaller than about 40 m are not resolved.
- Ideal Sun-tracking solar panel; no thermal, dust or wheel-slip model.
- Communication is geometry only — no DSN antenna schedule or link budget.
- Permanently shadowed areas are computed cold traps, **not confirmed ice**.
- At a 1 m mast our sunlight is too high (83.7 % vs 69.6 % published) because small nearby bumps are missing; at 5 m it matches.

## 11. Credits and use of AI
- NASA LRO LOLA team and NASA GSFC Planetary Geodesy Data Archive; JPL Solar System Dynamics (Horizons, DE421); NASA Deep Space Network.
- Open terrain patches from **LUNAR//OPS** (Apache-2.0) and **Lunar Horizon / CLPS-MOON-BROWSER** (MIT), credited in `pipeline/data/third_party/`. All LUNARIS analysis code is our own.
- Skyfield (MIT), React, Vite, three.js, Recharts.
- **Use of AI:** the team used an AI assistant (Claude, by Anthropic) to help with ideas, research, code, debugging, documents and slides. Every number comes from running our code, and the team reviewed the work. No AI-generated images are used.

## 12. Team — Karak & Cosmos
| Name | Student ID |
|---|---|
| Saoud Abdulaziz Bumjaid | NV24172 |
| Abdulrahman Ahmed Albi | NV24142 |
| Rashid Alothman | NV24219 |

Nasser Centre for Science & Technology (NCST), Kingdom of Bahrain. Thanks to our mentor, Sayed Hashim.

---

<a id="arabic"></a>
<div dir="rtl" align="right">

# العربية

## ١. المشكلة
المهمات إلى القطب الجنوبي للقمر تواجه ظروفًا صعبة جدًا. الشمس تبقى قريبة من الأفق بدرجات قليلة، فتصنع التلال ظلالًا طويلة جدًا تتحرك كل ساعة. والأرض أيضًا منخفضة في السماء، فكثيرًا ما تحجب التضاريس الاتصال اللاسلكي. وأهم الأهداف العلمية — الجليد المائي المحتمل — موجودة في فوهات لا تصلها الشمس أبدًا.
يحتاج مخططو المهمات أن يعرفوا لكل موقع وتاريخ: **كم ضوء الشمس المتاح؟ متى تكون الأرض ظاهرة؟ هل الأرض آمنة للهبوط؟ وهل تستطيع العربة الجوالة الوصول إلى الهدف والعودة قبل أن تنفد طاقتها؟**

## ٢. حلّنا
LUNARIS تطبيق ويب تفاعلي يجيب عن هذه الأسئلة باستخدام **تضاريس حقيقية من ناسا**، ويتبع المهمة في أربع خطوات:

- **١.** **اختيار الموقع** — ست مناطق حقيقية عند القطب الجنوبي (٨ × ٨ كم)، منها **موقع هبوط IM-2 Athena ضمن برنامج CLPS**.
- **٢.** **فحص الشمس والأرض** — لأي ساعة: موقع الشمس والأرض بالنسبة لخط الأفق الحقيقي، وكمية الضوء، والطاقة الشمسية، ونوافذ الاتصال.
- **٣.** **الهبوط الآمن** — مخاطر الانحدار داخل منطقة الهبوط كاملة، وستة معايير موزونة بمعادلات ظاهرة، وأفضل تاريخ للهبوط.
- **٤.** **القيادة بذكاء مع الشمس** — مسار للعربة يتغير مع الوقت، يتجنب الظلال المتحركة ويحافظ على البطارية.

الأدوات الموجودة تجيب عن سؤال *"أين ومتى تتوفر الشمس والأرض؟"*. LUNARIS يحتفظ بذلك، ويضيف ما تحتاجه المهمة بعد الهبوط: مخاطر الهبوط، وتخطيط مسار العربة مع نموذج للبطارية، ومقارنة التواريخ، وسيناريوهات "ماذا لو".

## ٣. صفحات التطبيق
- **South Pole Map — خريطة القطب الجنوبي:** خريطة تضاريس من بيانات LOLA يمكن تكبيرها وتحريكها، تظهر المناطق الست بحجمها الحقيقي، وعند التكبير تظهر طبقة الإضاءة السنوية بدقة ٤٠ مترًا، مع الإحداثيات تحت المؤشر.
- **Mission Command — مركز المهمة:** نظرة عامة على المنطقة، والمواقع المرشحة مع درجاتها، والأهداف الباردة، والمخاطر.
- **Lunar Explorer — المستكشف القمري:** تضاريس ثلاثية وثنائية الأبعاد مع ٨ طبقات بيانات وحركة الظلال.
- **Sun & Earth — الشمس والأرض:** لأي موقع وساعة: اتجاه وارتفاع الشمس والأرض، وارتفاع التضاريس في نفس الاتجاه، والجزء الظاهر من الشمس، وهل الأرض ظاهرة، وأي محطات شبكة الفضاء العميق (DSN) التابعة لناسا ترى القمر، ونوافذ الإضاءة والاتصال، والطاقة الشمسية اليومية.
- **Compare Sites — مقارنة المواقع:** مقارنة ٢ إلى ٤ مواقع من أي منطقة، **أو موقع واحد في ٤ تواريخ**، مع شرح حساب الفائز، ورسوم بيانية متزامنة، وتصدير CSV مع مصدر البيانات.
- **Landing Safety — سلامة الهبوط:** خريطة مخاطر الانحدار داخل منطقة الهبوط، وستة معايير بمعادلات ظاهرة، وأفضل تاريخ هبوط خلال ٩٠ يومًا.
- **Traverse Planner — مخطط المسار:** مقارنة أقصر مسار مع المسار الذكي مع الشمس، ومستوى البطارية على طول المسار، وأفضل أوقات الانطلاق.
- **What If? — ماذا لو:** تأخر الهبوط، ظلال أطول، انقطاع الاتصال، طريق مغلق، طاقة شمسية أقل — قبل وبعد مع السبب.
- **Data & Sources — البيانات والمصادر:** مصدر كل طبقة، والطرق، والفحوصات، والقيود.

## ٤. بيانات حقيقية من ناسا
- **التضاريس:** بيانات مقياس الارتفاع الليزري LOLA على مركبة LRO التابعة لناسا — دقة ٢٠ مترًا قرب كل موقع، و٤٠٠ متر حتى مسافة ٣٠٠ كم.
- **مواقع الشمس والأرض والقمر:** جداول JPL DE421 مع نموذج دوران القمر المعتمد من الاتحاد الفلكي الدولي.
- **التحقق:** نظام JPL Horizons التابع لناسا.

كل رقم في التطبيق **محسوب بكودنا** من هذه البيانات، ولا يوجد أي رقم مخترع أو تجريبي.

## ٥. تحققنا من أرقامنا — كلها ناجحة
- اتجاهات الشمس والأرض مقارنة بـ **JPL Horizons** على ٨٧٦١ ساعة: أكبر فرق **٠٫٠٠٣ درجة**.
- الإضاءة على التضاريس الحقيقية مقارنة بدراسة منشورة (Barker وآخرون ٢٠٢١): LUNARIS **٨٩٫٢٪** مقابل **٨٨٫١٪** منشورة.
- ارتفاع القمر من محطة Goldstone مقارنة بـ **JPL Horizons** على ٧٢١ ساعة: أكبر فرق **٠٫٠٠١٣ درجة**، واتفقت كل الساعات.
- الاختبارات الآلية: ٥٧/٥٧ للمخطِّط، ٥٢/٥٢ لمحرك الشمس والأرض، ٢٥/٢٥ خطوة في المتصفح بما فيها شاشة الجوال.

## ٦. النتيجة الرئيسية
في **٣٠٠ وقت انطلاق** في ٥ مناطق، وبنفس العربة:
- أقصر مسار أعاد العربة بنجاح **١٣٦** مرة،
- ومخطط LUNARIS الذكي مع الشمس أعادها **١٩٣** مرة — أي **أكثر بنسبة ٤٢٪**.

مثال — Malapert Massif في ١٥ يناير ٢٠٢٧: أقصر مسار تنخفض فيه البطارية تحت الاحتياطي (٢٠٪) بعد ٤٫٣ ساعات، أما المسار الذكي فهو أطول بـ ٠٫٩ كم لكنه يكمل الرحلة (٤٫٢ كم) في ١٤٫٧ ساعة وتبقى البطارية ٣٢٪.

## ٧. كيف يعمل
- **١.** **معالجة بلغة Python:** حساب خط الأفق لكل خلية ٤٠ مترًا في ٧٢ اتجاهًا مع انحناء القمر، ثم الإضاءة ورؤية الأرض والانحدار والمناطق المظللة دائمًا لكل ساعة في عام ٢٠٢٧، ورؤية محطات DSN للقمر.
- **٢.** **تطبيق الويب (React + TypeScript):** يحمّل البيانات الجاهزة ويشغّل التقييم والمقارنة ومخطط المسار **داخل المتصفح**.
- **٣.** **المخطط الذكي مع الشمس:** بحث A* يعتمد على الوقت عبر (المكان، الساعة، البطارية)، ويفحص في كل خطوة الانحدار والإضاءة والطاقة، ويمكن للعربة الانتظار لإعادة الشحن.
- **٤.** **الاتصال بثلاثة مستويات منفصلة:** الأرض ظاهرة (محسوب) ← محطة DSN ترى القمر (محسوب) ← اتصال فعلي (يحتاج حجز هوائي — غير محسوب).

## ٨. طريقة التشغيل
- **الأسهل:** افتح التطبيق مباشرة — https://ipo735723-afk.github.io/LUNARIS/
- **على جهازك (ويندوز):** ثبّت Node.js من https://nodejs.org ثم انقر مرتين على `START_LUNARIS.bat`.

## ٩. القيود (بكل وضوح)
- الصخور والفوهات الأصغر من حوالي ٤٠ مترًا غير ظاهرة.
- لوح شمسي مثالي، بدون نموذج حرارة أو غبار.
- الاتصال هندسي فقط، بدون جدولة هوائيات DSN.
- المناطق المظللة دائمًا هي مصائد باردة محسوبة، **وليست جليدًا مؤكدًا**.

## ١٠. المصادر واستخدام الذكاء الاصطناعي
- فريق LOLA وأرشيف PGDA في ناسا، وقسم ديناميكيات النظام الشمسي في JPL، وشبكة الفضاء العميق التابعة لناسا.
- بيانات تضاريس مفتوحة من مشروعي LUNAR//OPS وLunar Horizon مع ذكر الترخيص، وكل كود التحليل من عملنا.
- **استخدام الذكاء الاصطناعي:** استعان الفريق بمساعد ذكاء اصطناعي (Claude من Anthropic) في الأفكار والبحث والبرمجة والتوثيق والعرض. كل الأرقام ناتجة عن تشغيل الكود، وراجع الفريق العمل. لا توجد صور مولّدة بالذكاء الاصطناعي.

## ١١. الفريق — Karak & Cosmos
- Saoud Abdulaziz Bumjaid — NV24172
- Abdulrahman Ahmed Albi — NV24142
- Rashid Alothman — NV24219

مركز ناصر العلمي والتقني (NCST)، مملكة البحرين. شكرًا لمرشدنا Sayed Hashim.

> نموذج أولي مستقل من طلاب، وليس تابعًا لناسا ولا معتمدًا منها.

</div>
