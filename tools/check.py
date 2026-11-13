#!/usr/bin/env python3
"""Controle vóór elke push: python3 tools/check.py
1. plan.json voldoet aan de afspraken in CLAUDE.md.
2. Rooktest in een headless browser (Playwright, als die er is): geen JS-fouten, elk blok rendert en loopt af."""
import json, subprocess, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
PHASES = {"Warming-up", "Hoofddeel", "Metcon", "Cooldown"}
NEED = {"intervals": ["rounds", "work", "rest", "workLabel", "restLabel", "items"], "sets": ["rest", "sets"],
        "emom": ["minutes", "stations"], "amrap": ["minutes", "moves"], "fortime": ["cap", "moves"]}
errs, warns = [], []
plan = json.loads((ROOT / "plan.json").read_text())
for k in ("week", "year", "label", "days"):
    if k not in plan: errs.append(f"plan.{k} ontbreekt")
if not isinstance(plan.get("week"), int): errs.append("plan.week moet een geheel getal zijn (ISO-weeknummer)")
if f"Week {plan.get('week')}" not in str(plan.get("label")): errs.append("plan.label moet beginnen met 'Week <week>'")
ids = [d.get("id") for d in plan.get("days", [])]
if len(ids) != len(set(ids)) or not ids: errs.append("days: id's ontbreken of zijn niet uniek")
for d in plan.get("days", []):
    w = f"dag {d.get('id')}"
    for k in ("id", "weekday", "label", "sub", "name", "gear", "blocks"):
        if k not in d: errs.append(f"{w}: {k} ontbreekt")
    if d.get("weekday") not in range(1, 8): errs.append(f"{w}: weekday moet 1 (ma) t/m 7 (zo) zijn")
    for i, b in enumerate(d.get("blocks", [])):
        wb = f"{w} blok {i + 1}"
        if b.get("phase") not in PHASES: errs.append(f"{wb}: phase moet één van {sorted(PHASES)} zijn")
        if b.get("type") not in NEED: errs.append(f"{wb}: onbekend type {b.get('type')}"); continue
        if not b.get("title"): errs.append(f"{wb}: title ontbreekt")
        if "scale" in b: errs.append(f"{wb}: geen scale-veld gebruiken")
        for k in NEED[b["type"]]:
            if k not in b: errs.append(f"{wb}: {k} ontbreekt voor type {b['type']}")
        if b["type"] == "intervals" and len(b.get("items", [])) != b.get("rounds"): errs.append(f"{wb}: aantal items moet gelijk zijn aan rounds")
        if b["type"] == "sets":
            if any(isinstance(s.get("kg"), (int, float)) for s in b.get("sets", [])) and not b.get("key"):
                errs.append(f"{wb}: key ontbreekt (vaste naam van de oefening, voor 'Vorige keer')")
            for s in b.get("sets", []):
                if "l" not in s or "r" not in s or not isinstance(s["r"], str): errs.append(f"{wb}: elke set heeft l en r (tekst) nodig")
                if "kg" in s and not (isinstance(s["kg"], (int, float)) or s["kg"] == "lg"): errs.append(f"{wb}: kg is een getal of \"lg\"")
        if b["type"] in ("amrap", "fortime") and any(len(m) != 2 for m in b.get("moves", [])): errs.append(f"{wb}: moves zijn paren [naam, aantal]")
if errs:
    print("FOUTEN in plan.json:"); [print(" -", e) for e in errs]; sys.exit(1)
print("plan.json: in orde")
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Playwright niet gevonden: rooktest overgeslagen"); sys.exit(0)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8799", "-d", str(ROOT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); js = []
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(); pg = br.new_page(viewport={"width": 390, "height": 844})
        pg.on("pageerror", lambda e: js.append(str(e)))
        pg.clock.install(time="2026-01-05T19:00:00"); pg.goto("http://localhost:8799/"); pg.wait_for_selector(".day")
        if f"Week {plan['week']}" not in pg.inner_text("#weeklbl"): errs.append("weeklabel klopt niet")
        for d in plan["days"]:
            pg.click(f'.day[data-d="{d["id"]}"]')
            if pg.locator(".gear li").count() != len(d["gear"]): errs.append(f"{d['id']}: klaarzetlijst onvolledig")
            for i, b in enumerate(d["blocks"]):
                pg.click(f".seg[data-i='{i}']"); wb = f"{d['id']} blok {i + 1} ({b['title']})"
                if b["type"] == "intervals":
                    for it in b["items"]:
                        if not pg.evaluate("t => !!figKey(t)", it) and b["phase"] in ("Warming-up", "Cooldown"): warns.append(f"{wb}: geen tekening bij '{it}'")
                if b["type"] == "sets":
                    for _ in b["sets"]:
                        pg.click("#go")
                        if "skip" in pg.inner_text("#go").lower(): pg.click("#go")
                    if "klaar" not in pg.inner_text("#go").lower(): errs.append(f"{wb}: sets ronden niet af")
                else:
                    pg.click("#go"); pg.clock.run_for(3000)
                    if not pg.evaluate("document.body.classList.contains('focus')"): errs.append(f"{wb}: focusweergave start niet")
                    total = 10 + {"intervals": lambda: b["rounds"] * b["work"] + (b["rounds"] - 1) * b["rest"], "emom": lambda: b["minutes"] * 60,
                                  "amrap": lambda: b["minutes"] * 60, "fortime": lambda: b["cap"] * 60}[b["type"]]()
                    pg.clock.run_for(total * 1000 + 2000)
                    if "blok klaar" not in pg.inner_text("#cst").lower(): errs.append(f"{wb}: timer loopt niet af")
            pg.click(f".seg[data-i='{len(d['blocks']) - 1}']"); pg.click("#next")
            if d["name"] not in pg.inner_text("#sumtxt"): errs.append(f"{d['id']}: samenvatting ontbreekt")
        br.close()
finally:
    srv.terminate()
for wn in warns: print("LET OP:", wn)
if js or errs:
    print("FOUTEN in de rooktest:"); [print(" -", e) for e in js + errs]; sys.exit(1)
print("rooktest: in orde")
