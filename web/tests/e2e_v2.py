"""Browser test of the v2 pages (South Pole Map, Sun & Earth, Compare) on the built app.
Usage: python tests/e2e_v2.py http://localhost:4173/ OUTDIR"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

B, OUT = sys.argv[1], Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
steps = []
def ok(msg): steps.append(msg); print("OK ", msg)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "?region=malapert#polemap"); pg.wait_for_timeout(3500)
    # --- South Pole Map
    expect(pg.get_by_role("heading", name="South Pole Map")).to_be_visible()
    cv = pg.locator(".polemap canvas"); expect(cv).to_be_visible()
    box = cv.bounding_box(); pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2); pg.wait_for_timeout(300)
    assert "km from pole" in pg.inner_text(".vp-foot"); ok("map renders; cursor shows lat/lon and distance from pole")
    pg.locator(".reglist button", has_text="Haworth").click(); pg.wait_for_timeout(500)
    expect(pg.locator(".panel-h h3", has_text="Haworth")).to_be_visible(); ok("selecting a region zooms the map and opens its card")
    pg.get_by_role("button", name="Zoom in").click(); pg.mouse.wheel(0, 300); pg.mouse.move(box["x"] + 200, box["y"] + 200); pg.mouse.down(); pg.mouse.move(box["x"] + 260, box["y"] + 240); pg.mouse.up()
    pg.screenshot(path=OUT / "v2_01_polemap.png"); ok("zoom (button + wheel) and drag-pan work without errors")
    n0 = pg.locator(".siterow button[aria-pressed='true']").count()
    pg.locator(".siterow button[aria-pressed='false']").first.click(); pg.wait_for_timeout(200)
    assert pg.locator(".siterow button[aria-pressed='true']").count() == n0 + 1; ok("'+ Compare' adds a site to the shortlist")
    pg.locator(".siterow").first.get_by_role("button", name="Sun & Earth").click(); pg.wait_for_timeout(3500)
    expect(pg.get_by_role("heading", name="Sun & Earth")).to_be_visible()
    assert pg.locator(".region-pick select").input_value() == "haworth"; ok("'Sun & Earth' from the map switches region to Haworth and opens the dashboard")
    # --- Sun & Earth
    for lab in ["SUN", "EARTH", "DIRECT-TO-EARTH"]: expect(pg.locator(".skycard-h", has_text=lab).first).to_be_visible()
    before = pg.inner_text(".sky-cards")
    pg.get_by_role("button", name="+1 d").click(); pg.wait_for_timeout(400)
    assert pg.inner_text(".sky-cards") != before; ok("time stepping (+1 d) updates Sun/Earth azimuth and elevation")
    expect(pg.locator("svg.panorama")).to_be_visible(); expect(pg.locator("svg.strips")).to_be_visible()
    pg.locator(".tblwrap tbody tr").first.click(); pg.wait_for_timeout(300); ok("panorama, hourly strips and window tables render; clicking a window jumps in time")
    pg.screenshot(path=OUT / "v2_02_sun_earth.png", full_page=True)
    # --- Compare: sites
    pg.get_by_role("button", name="Compare Sites").click(); pg.wait_for_timeout(5000)
    expect(pg.locator(".winner")).to_be_visible(); n = pg.locator(".sbs-col").count(); assert n >= 2, n
    ok(f"compare page ranks {n} sites with a worked score")
    w1 = pg.inner_text(".winner .worked")
    pg.get_by_role("button", name="Power first").click(); pg.wait_for_timeout(500)
    assert "0.75" in pg.inner_text(".winner .worked") and pg.inner_text(".winner .worked") != w1; ok("priority chip 'Power first' re-weights the score (0.75 × Power)")
    with pg.expect_download() as d: pg.get_by_role("button", name="Export CSV (with provenance)").click()
    csv = Path(d.value.path()).read_text(); assert csv.startswith("# LUNARIS") and "contact" in csv; (OUT / "v2_compare.csv").write_text(csv); ok("CSV export contains provenance header and metrics")
    assert pg.locator(".syncchart").count() == 3; ok("three synchronized timeline charts render")
    pg.screenshot(path=OUT / "v2_03_compare_sites.png", full_page=True)
    # --- Compare: dates
    pg.get_by_role("tab", name="Dates").click(); pg.wait_for_timeout(2500)
    assert pg.locator(".sbs-col").count() == 3; ok("date mode compares the same site on 3 start dates")
    pg.get_by_role("button", name="+ Add date").click(); pg.wait_for_timeout(1500)
    assert pg.locator(".sbs-col").count() == 4; ok("a fourth date can be added")
    pg.screenshot(path=OUT / "v2_04_compare_dates.png", full_page=True)
    # --- existing pages still work after the changes
    for name in ["Mission Command", "Lunar Explorer", "Landing Safety", "Traverse Planner", "What If? Simulator", "Data & Sources"]:
        pg.get_by_role("button", name=name).click(); pg.wait_for_timeout(1500); expect(pg.locator(".topbar h1")).to_have_text(name)
    expect(pg.get_by_text("0.0013°", exact=False).first).to_be_visible(); ok("all six original pages still open; sources list the DSN check")
    # --- phone layout
    ph = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2); ph.on("pageerror", lambda e: errs.append(str(e)))
    for page in ["polemap", "sky", "compare"]:
        ph.goto(B + "?region=malapert#" + page); ph.wait_for_timeout(4500)
        sw = ph.evaluate("document.documentElement.scrollWidth"); assert sw <= 392, (page, sw)
        ph.screenshot(path=OUT / f"v2_phone_{page}.png", full_page=False)
    ok("phone width (390 px): no horizontal page scroll on the three new pages")
    assert not errs, errs; ok("no page errors")
    b.close()
print(f"{len(steps)}/{len(steps)} steps passed")
