"""Browser test of the built LUNARIS app with real data. Usage: python tests/e2e_browser.py http://localhost:4173/ OUTDIR"""
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

B, OUT = sys.argv[1], Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
steps = []
def ok(msg): steps.append(msg); print("OK ", msg)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1440, "height": 900}); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "?region=malapert"); pg.wait_for_timeout(3500)
    expect(pg.get_by_text("REAL DATA · NASA LOLA + JPL DE421")).to_be_visible()
    assert pg.locator("select").input_value() == "malapert"; ok("real dataset loaded (Malapert Massif), REAL DATA label shown")
    pg.screenshot(path=OUT / "01_mission_command.png", full_page=True)
    pg.get_by_role("button", name="Lunar Explorer").click(); pg.wait_for_timeout(4000)
    expect(pg.locator("canvas").first).to_be_visible(); pg.screenshot(path=OUT / "02_explorer_3d.png", full_page=True); ok("3-D explorer renders terrain")
    pg.get_by_role("button", name="Landing Safety").click(); pg.wait_for_timeout(2500)
    pg.get_by_role("button", name="Scan next 90 days").click(); pg.wait_for_timeout(6000)
    pg.screenshot(path=OUT / "03_landing_safety.png", full_page=True); ok("landing-safety page + 90-day best-window scan ran")
    # The headline case found by tests/planner_real.test.ts: Malapert, departure 2027-01-15
    pg.get_by_role("button", name="Traverse Planner").click(); pg.wait_for_timeout(2000)
    pg.locator('input[type="datetime-local"]').fill("2027-01-15T00:00"); pg.wait_for_timeout(500)
    pg.get_by_role("button", name="Plan & compare routes").click()
    pg.wait_for_function("() => !document.body.innerText.includes('Planning…')", timeout=120000); pg.wait_for_timeout(1500)
    txt = pg.inner_text("body")
    pg.screenshot(path=OUT / "04_traverse_compare.png", full_page=True); ok("planned shortest vs sun-aware routes")
    print("   route text excerpt:", " | ".join(l for l in txt.splitlines() if "reserve" in l or "FEASIBLE" in l or "BLOCKED" in l)[:400])
    pg.get_by_role("button", name="Find departure windows").click()
    pg.wait_for_function("() => !document.body.innerText.includes('Scanning…')", timeout=300000); pg.wait_for_timeout(1000)
    pg.screenshot(path=OUT / "05_departure_windows.png", full_page=True); ok("departure-window scan finished")
    pg.get_by_role("button", name="What If? Simulator").click(); pg.wait_for_timeout(1500)
    pg.get_by_role("button", name="Less solar energy").click(); pg.get_by_role("button", name="Run scenario vs baseline").click()
    pg.wait_for_function("() => !document.body.innerText.includes('Simulating…')", timeout=180000); pg.wait_for_timeout(1500)
    pg.screenshot(path=OUT / "06_what_if.png", full_page=True); ok("What-If 'less solar energy' scenario compared with baseline")
    pg.get_by_role("button", name="Data & Sources").click(); pg.wait_for_timeout(1000)
    expect(pg.get_by_text("0.003°", exact=False).first).to_be_visible(); pg.screenshot(path=OUT / "07_data_sources.png", full_page=True); ok("sources page shows validation results")
    pg.select_option("select", "im2-athena"); pg.wait_for_timeout(3500)
    pg.get_by_role("button", name="Mission Command").click(); pg.wait_for_timeout(1500)
    assert pg.locator("select").input_value() == "im2-athena" and "IM-2 Athena (CLPS landing site)" in pg.inner_text("header.topbar")
    pg.screenshot(path=OUT / "08_region_im2.png", full_page=True); ok("region switch to the IM-2 Athena CLPS landing site")
    assert not errs, errs; ok("no page errors")
    b.close()
(OUT / "e2e_result.json").write_text(json.dumps({"steps": steps, "passed": len(steps)}, indent=2))
print(f"{len(steps)} steps passed")
