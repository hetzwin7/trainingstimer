"use strict";
/* Trainingstimer — vaste app. Het weekschema staat los in plan.json en wordt wekelijks vervangen.
   Tijd loopt op de klok (Date.now), niet op tikken: na een vergrendeld scherm klopt de stand weer.
   De hele sessie (ook lopende timers) wordt bewaard, zodat een herladen pagina niets kost. */

const PREP = 10;
const STATE_KEY = "tt-state-v2", PLAN_KEY = "tt-plan-v1", HIST_KEY = "tt-hist-v1", HINT_KEY = "tt-hint-v1";
const FEELS = ["Te licht", "Goed", "Zwaar", "Niet gehaald"];

let PLAN = null, PID = "", S = null;

/* ===== Helpers ===== */
const $ = id => document.getElementById(id);
const now = () => Date.now();
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const mkT = () => ({acc: 0, at: null});
const tEl = t => (t.acc + (t.at ? now() - t.at : 0)) / 1000;
const tStart = t => { if (!t.at) t.at = now(); };
const tPause = t => { if (t.at) { t.acc += now() - t.at; t.at = null; } };
const tReset = t => { t.acc = 0; t.at = null; };
const fmt = s => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); };
const numKg = kg => typeof kg === "number";
const kgNum = kg => String(kg).replace(".", ",");
const kgTxt = kg => kg === undefined ? "" : (kg === "lg" ? "lichaamsgewicht" : kgNum(kg) + " kg");
const repTxt = r => r === "circuit" ? "circuit" : (/^\d+$/.test(r) ? r + "×" : r);
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

/* ===== Illustraties ===== */
function figKey(txt) { for (const [re, k] of FIGMAP) if (re.test(txt || "") && FIG[k]) return k; return null; }
function figSVG(txt, small) {
  const k = figKey(txt); if (!k) return "";
  const f = FIG[k], mirror = /rechts/i.test(txt) && !f.front && !f.top;
  const pl = pts => `<polyline points="${pts.map(p => p.join(",")).join(" ")}"/>`;
  const body = `${f.nofloor || f.top ? "" : `<line class="fl" x1="4" y1="110" x2="196" y2="110"/>`}${f.x || ""}
    <g class="ghostfig">${(f.f || []).map(pl).join("")}</g><g class="fig">${f.l.map(pl).join("")}<circle cx="${f.h[0]}" cy="${f.h[1]}" r="9"/></g>`;
  return `<svg viewBox="0 0 200 120" class="${small ? "fsm" : "fbig"}" role="img" aria-label="${esc(txt)}">${mirror ? `<g transform="translate(200 0) scale(-1 1)">${body}</g>` : body}</svg>`;
}
const figDesc = txt => { const k = figKey(txt); return k ? FIG[k].d : ""; };

/* ===== Geluid, trillen, flits, scherm wakker ===== */
let ac = null, soundOn = true;
function unlock() {
  try {
    // "transient": korte signalen bovenop andere audio (muziek blijft spelen) en niet stil door de stilteknop, waar de browser dit ondersteunt.
    if (navigator.audioSession && navigator.audioSession.type !== "transient") navigator.audioSession.type = "transient";
  } catch (e) {}
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state !== "running") ac.resume();
  } catch (e) {}
}
document.addEventListener("pointerdown", unlock, true);
document.addEventListener("keydown", unlock, true);
function beep(freq, dur, vol) {
  if (!soundOn || !ac) return;
  try {
    const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime;
    o.type = "square"; o.frequency.value = freq || 880;
    g.gain.setValueAtTime(vol || 0.18, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 0.12));
    o.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + (dur || 0.12) + 0.03);
  } catch (e) {}
}
const buzz = p => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
function flash() { const c = document.body.classList; c.remove("flash"); void document.body.offsetWidth; c.add("flash"); }
const tickBeep = () => { beep(660, 0.09); buzz(60); };
const goBeep = () => { beep(1100, 0.35, 0.22); buzz([120, 60, 120]); flash(); };
const endBeep = () => { beep(1100, 0.25); setTimeout(() => beep(1400, 0.45), 300); buzz([200, 80, 200, 80, 300]); flash(); };
let wl = null;
async function keepAwake() {
  try { if ("wakeLock" in navigator && !wl) { wl = await navigator.wakeLock.request("screen"); wl.addEventListener("release", () => { wl = null; }); } } catch (e) { wl = null; }
}

/* ===== Schema laden ===== */
async function fetchPlan() {
  if (window.__PLAN__) return window.__PLAN__;                 // losse proefversie: schema zit in de pagina
  try {
    const r = await fetch("plan.json?t=" + now(), {cache: "no-store"});
    if (!r.ok) throw new Error(r.status);
    const p = await r.json(); lsSet(PLAN_KEY, p); return p;
  } catch (e) { return lsGet(PLAN_KEY); }                       // geen bereik: laatste bekende schema
}
const planId = p => `${p.year || ""}-w${p.week}`;
function usePlan(p) {
  PLAN = p; PID = planId(p);
  Object.assign(FIG, p.figs || {});
  (p.figmap || []).forEach(([re, k]) => { try { FIGMAP.unshift([new RegExp(re, "i"), k]); } catch (e) {} });
  const snap = lsGet(STATE_KEY), ok = snap && snap.pid === PID;
  const today = new Date().getDay() || 7;
  let def = PLAN.days[0].id;
  PLAN.days.forEach(d => { if ((d.weekday || 1) <= today) def = d.id; });
  S = { view: "main", day: ok && PLAN.days.some(d => d.id === snap.day) ? snap.day : def, days: {} };
  PLAN.days.forEach(d => { S.days[d.id] = freshDay(d, ok ? snap.days[d.id] : null, ok ? snap.savedAt : 0); });
  const lbl = $("weeklbl"), stale = PLAN.week !== isoWeek(new Date());
  lbl.textContent = PLAN.label + (stale ? " · niet deze week" : "");
  lbl.classList.toggle("stale", stale);
  $("days").innerHTML = PLAN.days.map(d => `<button class="day" type="button" data-d="${esc(d.id)}" aria-pressed="false"><b>${esc(d.label)}</b><span>${esc(d.sub || "")}</span></button>`).join("");
  $("days").querySelectorAll(".day").forEach(el => el.onclick = () => { pauseAll(); S.day = el.dataset.d; S.view = "main"; persist(); render(); });
  render();
}

/* ===== Toestand ===== */
function freshDay(day, sv, savedAt) {
  sv = sv || {};
  // Een timer die liep toen de pagina verdween, komt gepauzeerd terug op de laatst bewaarde stand.
  const fixT = t => t ? {acc: (t.acc || 0) + (t.at ? Math.max(0, savedAt - t.at) : 0), at: null} : mkT();
  const g = day.gear || [];
  return {
    idx: Math.min(sv.idx || 0, day.blocks.length), clock: fixT(sv.clock), finishedAt: sv.finishedAt || null, notes: sv.notes || "",
    gearOn: sv.gearOn && sv.gearOn.length === g.length ? sv.gearOn : g.map(() => false),
    blocks: day.blocks.map((b, i) => {
      const o = (sv.blocks && sv.blocks[i]) || {}, n = b.sets ? b.sets.length : 0;
      return { t: fixT(o.t), done: !!o.done, rounds: o.rounds || 0, note: o.note || "", ftime: o.ftime == null ? null : o.ftime, feel: o.feel || "",
               checked: o.checked && o.checked.length === n ? o.checked : Array(n).fill(false),
               kg: o.kg && o.kg.length === n ? o.kg : Array(n).fill(null), lastSeg: -1, lastSec: -1 };
    })
  };
}
const P = () => PLAN.days.find(d => d.id === S.day);
const D = () => S.days[S.day];
let lastPersist = 0;
function persist() {
  if (!S) return;
  lastPersist = now();
  const days = {};
  for (const id in S.days) { const d = S.days[id];
    days[id] = { idx: d.idx, clock: d.clock, finishedAt: d.finishedAt, notes: d.notes, gearOn: d.gearOn,
      blocks: d.blocks.map(b => ({t: b.t, done: b.done, checked: b.checked, rounds: b.rounds, note: b.note, ftime: b.ftime, kg: b.kg, feel: b.feel})) }; }
  lsSet(STATE_KEY, {pid: PID, savedAt: lastPersist, day: S.day, days});
  saveHistory();
}
const kgOf = (b, st, k) => (st.kg && st.kg[k] != null) ? st.kg[k] : b.sets[k].kg;
const rated = b => b.phase !== "Warming-up" && b.phase !== "Cooldown";
function anyRunning() { return !!S && Object.values(S.days).some(d => d.blocks.some(x => x.t.at)); }

/* ===== Historie: gewichten per oefening + afgeronde sessies ===== */
const liftKey = b => (b.key || b.title.split("·")[0]).trim().toLowerCase();
const dateTxt = ts => new Date(ts).toLocaleDateString("nl-NL", {weekday: "short", day: "numeric", month: "short"});
function saveHistory() {
  const H = lsGet(HIST_KEY) || {}; H.lifts = H.lifts || {}; H.sessions = H.sessions || [];
  for (const day of PLAN.days) {
    const d = S.days[day.id];
    day.blocks.forEach((b, i) => {
      if (b.type !== "sets" || !b.sets.some(s => numKg(s.kg))) return;
      const st = d.blocks[i], id = `${PID}:${day.id}:${i}`, key = liftKey(b);
      const was = (H.lifts[key] || []).find(x => x.id === id), list = (H.lifts[key] || []).filter(x => x.id !== id);
      if (st.checked.some(Boolean)) list.push({ id, week: PLAN.week, ts: was ? was.ts : now(), feel: st.feel,
        sets: b.sets.map((s, k) => ({r: s.r, kg: numKg(s.kg) ? kgOf(b, st, k) : null, ok: st.checked[k]})) });
      H.lifts[key] = list.slice(-12);
    });
    const sid = `${PID}:${day.id}`;
    if (d.idx >= day.blocks.length) {
      const old = H.sessions.find(x => x.id === sid);
      H.sessions = H.sessions.filter(x => x.id !== sid);
      H.sessions.push({id: sid, name: day.name, ts: old ? old.ts : now(), text: summaryLines(day, d).join("\n")});
      H.sessions.sort((a, b) => a.ts - b.ts); H.sessions = H.sessions.slice(-20);
    }
  }
  lsSet(HIST_KEY, H);
}
function prevLift(b, i) {
  const H = lsGet(HIST_KEY), id = `${PID}:${S.day}:${i}`;
  const list = ((H && H.lifts && H.lifts[liftKey(b)]) || []).filter(x => x.id !== id);
  const e = list[list.length - 1]; if (!e) return "";
  const done = e.sets.filter(s => s.ok), kgs = done.map(s => s.kg).filter(numKg);
  if (!done.length) return "";
  const top = kgs.length ? Math.max(...kgs) : null;
  return `<p class="prev">Vorige keer (week ${e.week}, ${dateTxt(e.ts)}): <b>${done.length}/${e.sets.length} sets${top != null ? `, zwaarste ${kgNum(top)} kg` : ""}</b>${e.feel ? ` · ${esc(e.feel)}` : ""}</p>`;
}

/* ===== Tijdlijn per getimed blok ===== */
function segments(b) {
  const s = [{kind: "prep", label: "Klaar maken", dur: PREP}];
  if (b.type === "intervals") {
    for (let r = 0; r < b.rounds; r++) {
      s.push({kind: "work", label: b.workLabel, dur: b.work, round: r, item: b.items[r] || "", nextItem: b.items[r + 1] || ""});
      if (b.rest && r < b.rounds - 1) s.push({kind: "rest", label: b.restLabel, dur: b.rest, round: r, item: b.items[r + 1] || ""});
    }
  } else if (b.type === "emom") {
    for (let m = 0; m < b.minutes; m++) s.push({kind: "work", label: "Minuut " + (m + 1) + " / " + b.minutes, dur: 60, min: m, station: b.stations[m % b.stations.length], nextSt: b.stations[(m + 1) % b.stations.length], last: m === b.minutes - 1});
  } else if (b.type === "amrap") {
    s.push({kind: "work", label: "AMRAP", dur: b.minutes * 60});
  } else if (b.type === "fortime") {
    s.push({kind: "up", label: "For time", dur: b.cap * 60});
  }
  return s;
}
const totalDur = b => segments(b).reduce((a, x) => a + x.dur, 0);
function locate(b, t) {
  const segs = segments(b); let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    if (t < acc + segs[i].dur) return {i, seg: segs[i], into: t - acc, left: acc + segs[i].dur - t, segs};
    acc += segs[i].dur;
  }
  return {i: segs.length, seg: null, into: 0, left: 0, segs, end: true};
}
const emomMins = (b, k) => { const o = []; for (let m = k; m < b.minutes; m += b.stations.length) o.push(m + 1); return o.join(" · "); };
const timed = b => ["intervals", "emom", "amrap", "fortime"].includes(b.type);

/* ===== Voortgang ===== */
function blockFrac(i) {
  const b = P().blocks[i], st = D().blocks[i];
  if (st.done) return 1;
  if (b.type === "sets") return st.checked.filter(Boolean).length / b.sets.length;
  return Math.min(1, tEl(st.t) / totalDur(b));
}
function renderProg() {
  const d = D();
  $("prog").innerHTML = P().blocks.map((b, i) =>
    `<button class="seg${i === d.idx ? " cur" : ""}${d.blocks[i].done ? " ok" : ""}" type="button" data-i="${i}" aria-label="${esc(b.phase)}: ${esc(b.title)}"><i id="pf${i}"></i></button>`).join("");
  $("prog").querySelectorAll(".seg").forEach(el => el.onclick = () => goTo(+el.dataset.i));
  updProg();
}
function updProg() {
  const n = P().blocks.length, d = D(); let sum = 0;
  for (let i = 0; i < n; i++) { const f = blockFrac(i); sum += f; const el = $("pf" + i); if (el) el.style.width = (f * 100).toFixed(1) + "%"; }
  $("progtxt").textContent = S.view === "log" ? "Logboek" : d.idx < n ? `Blok ${d.idx + 1}/${n} · ${P().blocks[d.idx].phase}` : "Samenvatting";
  $("progpct").textContent = Math.round(sum / n * 100) + "%";
}

/* ===== Render ===== */
function feelHTML(st) {
  return `<div class="feel"><span class="small">Hoe zwaar was dit?</span><div class="fb" role="group" aria-label="Hoe zwaar was dit?">` +
    FEELS.map(f => `<button type="button" data-f="${f}" aria-pressed="${st.feel === f}">${f}</button>`).join("") + `</div></div>`;
}
function head(b) {
  return `<div class="eyebrow"><span class="phase">${esc(b.phase)}</span><button class="reset" type="button" id="breset">Reset blok</button></div>
  <h2>${esc(b.title)}</h2>${b.note ? `<p class="note">${esc(b.note)}</p>` : ""}`;
}
function renderGear() {
  const g = P().gear || [], d = D(), n = d.gearOn.filter(Boolean).length;
  const ex = $("gear").querySelector("details"), open = (ex && $("gear").dataset.day === S.day) ? ex.open : true;
  $("gear").dataset.day = S.day;
  $("gear").innerHTML = g.length ? `<details class="gear"${open && n < g.length ? " open" : ""}><summary><span>Klaarzetten</span><span>${n}/${g.length}</span></summary><ul>` +
    g.map((x, k) => `<li><button type="button" class="${d.gearOn[k] ? "on" : ""}" data-g="${k}" role="checkbox" aria-checked="${d.gearOn[k]}"><span class="box">✓</span><span>${esc(x)}</span></button></li>`).join("") + `</ul></details>` : "";
  $("gear").querySelectorAll("[data-g]").forEach(el => el.onclick = () => { const k = +el.dataset.g; d.gearOn[k] = !d.gearOn[k]; persist(); renderGear(); });
}
function render() {
  const d = D(), p = P(), card = $("card");
  $("days").querySelectorAll(".day").forEach(el => el.setAttribute("aria-pressed", el.dataset.d === S.day));
  $("bar").hidden = S.view === "log";
  $("logb").textContent = S.view === "log" ? "‹ Terug" : "Logboek";
  renderGear(); renderProg();
  if (S.view === "log") { card.innerHTML = logHTML(); bindLog(); updBar(); return; }
  if (d.idx >= p.blocks.length) { card.innerHTML = summaryHTML(); bindSummary(); updBar(); return; }
  const b = p.blocks[d.idx], st = d.blocks[d.idx], nid = `note-${S.day}-${d.idx}`;
  let h = `<div class="card" data-type="${b.type}">` + head(b);
  if (b.type === "sets") {
    const nx = st.checked.indexOf(false);
    h += prevLift(b, d.idx);
    h += `<div class="sets">` + b.sets.map((s, k) => {
      const kg = numKg(s.kg) ? kgOf(b, st, k) : s.kg;
      return `<div class="setline"><button class="setrow${st.checked[k] ? " on" : ""}${k === nx ? " nxt" : ""}" type="button" data-k="${k}" role="checkbox" aria-checked="${st.checked[k]}">
        <span class="box">✓</span><span class="lbl">${esc(s.l)}${s.kg !== undefined && !numKg(s.kg) ? ` <span class="small">· ${kgTxt(s.kg)}</span>` : ""}</span><span class="r">${s.r === "circuit" ? "" : esc(repTxt(s.r))}</span></button>` +
        (numKg(s.kg) ? `<div class="kgs"><button type="button" class="kgb" data-k="${k}" data-d="-2.5" aria-label="${esc(s.l)}: 2,5 kg minder">−</button><span class="kgv${kg !== s.kg ? " chg" : ""}">${kgNum(kg)}<small>kg</small></span><button type="button" class="kgb" data-k="${k}" data-d="2.5" aria-label="${esc(s.l)}: 2,5 kg meer">+</button></div>` : "") + `</div>`;
    }).join("") + `</div>`;
    h += `<div class="restbox" id="restbox"><div><div class="small" id="restlbl">Rust tussen sets · ${fmt(b.rest)}</div><div class="t idle" id="rest">${fmt(b.rest)}</div></div>
          <button class="ghost" type="button" id="restp">Start rust</button></div>`;
    if (rated(b)) h += feelHTML(st);
    if (b.log) h += `<label class="fld" for="${nid}">Notitie<input type="text" id="${nid}" value="${esc(st.note)}" placeholder="bijv. laatste set rug rond, 2 reps gemist"></label>`;
  } else if (b.type === "intervals") {
    h += `<div class="clock"><div class="state" id="cst">Klaar?</div><div class="big" id="cbig">${fmt(PREP)}</div><div class="sub" id="csub">${b.rounds} × ${b.work} s / ${b.rest} s</div></div>
          <div class="station" id="cstation">${esc(b.items[0] || "")}</div><div class="next" id="cnext"></div>`;
    if (b.items.some(figKey)) h += `<figure class="illu" id="illu"></figure>`;
    if (b.items.length) h += `<ul class="moves">` + b.items.map((x, k) => `<li id="mv${k}" data-k="${k}"><span class="lt">${figSVG(x, true)}<span>${esc(x)}</span></span><b>${k + 1}</b></li>`).join("") + `</ul>`;
  } else if (b.type === "emom") {
    h += `<div class="clock"><div class="state" id="cst">Klaar?</div><div class="big" id="cbig">${fmt(PREP)}</div><div class="sub" id="csub">Minuut 1 / ${b.minutes}</div></div>
          <div class="station" id="cstation">${esc(b.stations[0])}</div><div class="next" id="cnext">Daarna: ${esc(b.stations[1 % b.stations.length])}</div>
          <ul class="moves">` + b.stations.map((x, k) => `<li id="mv${k}"><span>${esc(x)}</span><b class="mins">min ${emomMins(b, k)}</b></li>`).join("") + `</ul>`;
  } else if (b.type === "amrap") {
    h += `<div class="clock"><div class="state" id="cst">Klaar?</div><div class="big" id="cbig">${fmt(b.minutes * 60)}</div><div class="sub" id="csub">Aftellen vanaf ${b.minutes}:00</div></div>
          <div class="rounds"><button class="minus" type="button" id="rminus" aria-label="Ronde eraf">−</button>
          <div class="n" id="rn">${st.rounds}<small>rondes</small></div>
          <button class="plus" type="button" id="rplus" aria-label="Ronde erbij">+1</button></div>
          <ul class="moves">` + b.moves.map(m => `<li><span>${esc(m[0])}</span><b>${esc(m[1])}</b></li>`).join("") + `</ul>
          <label class="fld" for="${nid}">Extra reps / notitie<input type="text" id="${nid}" value="${esc(st.note)}" placeholder="bijv. + 250 m roeien"></label>`;
  } else if (b.type === "fortime") {
    h += `<div class="clock"><div class="state" id="cst">Klaar?</div><div class="big" id="cbig">0:00</div><div class="sub" id="csub">Tijdslimiet ${b.cap}:00</div></div>
          <button class="plus" type="button" id="ftdone">Klaar · stop tijd</button>
          <ul class="moves">` + b.moves.map(m => `<li><span>${esc(m[0])}</span><b>${esc(m[1])}</b></li>`).join("") + `</ul>`;
  }
  if (b.type !== "sets" && rated(b)) h += feelHTML(st);
  h += `</div>`;
  card.innerHTML = h;
  bindBlock(b, st);
  if (b.type === "intervals") { st.illuK = null; card.querySelectorAll(".moves li[data-k]").forEach(li => li.onclick = () => drawIllu(b.items[+li.dataset.k])); }
  updBar(); tick(true);
}
function drawIllu(item) {
  const el = $("illu"); if (!el) return;
  if (!figKey(item)) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = figSVG(item) + `<figcaption><b>${esc(item)}</b>${esc(figDesc(item))}</figcaption>`;
}
function autoIllu(b, st, k) {
  if (k < 0 || k >= b.items.length || st.illuK === k) return;
  st.illuK = k; drawIllu(b.items[k]);
}

function bindBlock(b, st) {
  $("breset").onclick = () => { tReset(st.t); st.done = false; st.rounds = 0; st.ftime = null; st.lastSeg = -1; st.lastSec = -1;
    if (b.type === "sets") st.checked = b.sets.map(() => false); persist(); render(); };
  const note = $(`note-${S.day}-${D().idx}`);
  if (note) note.oninput = () => { st.note = note.value; persist(); };
  $("card").querySelectorAll(".feel button").forEach(el => el.onclick = () => {
    st.feel = st.feel === el.dataset.f ? "" : el.dataset.f;
    $("card").querySelectorAll(".feel button").forEach(x => x.setAttribute("aria-pressed", x.dataset.f === st.feel));
    persist(); });
  if (b.type === "sets") {
    $("card").querySelectorAll(".kgb").forEach(el => el.onclick = () => {
      // de stap schuift ook de nog niet gedane sets erna op, zodat een opbouw (25 → 32,5) een opbouw blijft
      const k = +el.dataset.k, dk = +el.dataset.d;
      for (let j = k; j < b.sets.length; j++) if (j === k || (!st.checked[j] && numKg(b.sets[j].kg))) st.kg[j] = Math.max(0, kgOf(b, st, j) + dk);
      persist(); render(); });
    $("card").querySelectorAll(".setrow").forEach(el => el.onclick = () => {
      const k = +el.dataset.k; st.checked[k] = !st.checked[k]; afterSet(b, st, st.checked[k]); });
    $("restp").onclick = () => {
      if (st.t.at) tPause(st.t);
      else { if (!(tEl(st.t) > 0 && tEl(st.t) < b.rest)) { tReset(st.t); st.lastSec = -1; } startClock(); tStart(st.t); keepAwake(); }
      persist(); updBar(); tick(true); };
  }
  if (b.type === "amrap") {
    $("rplus").onclick = () => { st.rounds++; $("rn").firstChild.nodeValue = st.rounds; beep(990, .06); buzz(40); persist(); };
    $("rminus").onclick = () => { st.rounds = Math.max(0, st.rounds - 1); $("rn").firstChild.nodeValue = st.rounds; persist(); };
  }
  if (b.type === "fortime") {
    $("ftdone").onclick = () => { const L = locate(b, tEl(st.t)); if (L.seg && L.seg.kind === "up") { st.ftime = L.into; tPause(st.t); finishBlock(st); } };
  }
}
function afterSet(b, st, ticked) {
  st.done = st.checked.every(Boolean);
  if (ticked) {
    startClock(); tReset(st.t);
    if (!st.done) { tStart(st.t); st.lastSec = -1; keepAwake(); beep(880, .08); buzz(50); }
    else endBeep();
  }
  persist(); render();
  if (ticked && !st.done) window.scrollTo({top: 0});
}
function setDone() {
  const b = P().blocks[D().idx], st = D().blocks[D().idx], k = st.checked.indexOf(false);
  if (k < 0) return;
  st.checked[k] = true; afterSet(b, st, true);
}
function finishBlock(st) { st.done = true; tPause(st.t); endBeep(); persist(); render(); }
function startClock() { const d = D(); if (!d.clock.at && !d.finishedAt) tStart(d.clock); }

/* ===== Bediening ===== */
function updBar() {
  const d = D(), p = P(), go = $("go"), n = p.blocks.length;
  const b = p.blocks[d.idx], st = d.blocks[d.idx];
  const live = S.view === "main" && d.idx < n && !!st.t.at && !st.done;
  document.body.classList.toggle("focus", live && timed(b));
  document.body.classList.toggle("resting", live && b.type === "sets");
  $("prev").disabled = d.idx === 0;
  $("next").disabled = d.idx >= n;
  go.className = "go";
  if (d.idx >= n) { go.textContent = "Klaar ✓"; go.className = "go ok"; return; }
  if (b.type === "sets") {
    if (st.done) { go.textContent = "Klaar ✓"; go.className = "go ok"; }
    else if (st.t.at || (tEl(st.t) > 0 && tEl(st.t) < b.rest)) { go.textContent = "Rust skip"; go.className = "go pause"; }
    else go.textContent = "Set klaar";
    return;
  }
  if (st.done) { go.textContent = "Klaar ✓"; go.className = "go ok"; }
  else if (st.t.at) { go.textContent = "Pauze"; go.className = "go pause"; }
  else go.textContent = tEl(st.t) > 0 ? "Hervat" : "Start";
}
$("go").onclick = () => {
  if (!S) return;
  const d = D(), p = P();
  if (d.idx >= p.blocks.length) return;
  const b = p.blocks[d.idx], st = d.blocks[d.idx];
  if (st.done) { goTo(d.idx + 1); return; }
  if (b.type === "sets") {
    if (st.t.at || (tEl(st.t) > 0 && tEl(st.t) < b.rest)) { tReset(st.t); persist(); updBar(); tick(true); return; }
    setDone(); return;
  }
  if (st.t.at) tPause(st.t); else { startClock(); tStart(st.t); keepAwake(); }
  persist(); updBar(); tick(true);
};
function pauseAll() { D().blocks.forEach(x => tPause(x.t)); }
function goTo(i) {
  const d = D(), n = P().blocks.length;
  i = Math.max(0, Math.min(n, i));
  pauseAll();
  d.idx = i; S.view = "main";
  if (i >= n && !d.finishedAt) { tPause(d.clock); d.finishedAt = now(); }
  if (i < n && d.finishedAt) d.finishedAt = null;
  persist(); render(); window.scrollTo({top: 0});
}
$("prev").onclick = () => S && goTo(D().idx - 1);
$("next").onclick = () => S && goTo(D().idx + 1);
$("snd").onclick = () => { soundOn = !soundOn; $("snd").textContent = "Geluid: " + (soundOn ? "aan" : "uit"); if (soundOn) { unlock(); beep(880, .08); } };
$("logb").onclick = () => { if (!S) return; pauseAll(); S.view = S.view === "log" ? "main" : "log"; persist(); render(); window.scrollTo({top: 0}); };
let armReset = 0;
$("resetall").onclick = () => {
  if (!S) return;
  if (now() - armReset > 3000) { armReset = now(); $("resetall").textContent = "Tik nog eens"; setTimeout(() => $("resetall").textContent = "Dag resetten", 3000); return; }
  armReset = 0; S.days[S.day] = freshDay(P(), null, 0); S.view = "main";
  $("resetall").textContent = "Dag resetten"; persist(); render();
};

/* ===== Ticker ===== */
function tick(force) {
  if (!S) return;
  const d = D(), p = P();
  $("total").textContent = fmt(tEl(d.clock));
  if (S.view !== "main" || d.idx >= p.blocks.length) return;
  const b = p.blocks[d.idx], st = d.blocks[d.idx];
  if (b.type === "sets") {
    const el = $("rest"); if (!el) return;
    const e = tEl(st.t), left = b.rest - e, active = st.t.at || (e > 0 && left > 0);
    $("restbox").classList.toggle("live", !!st.t.at && left > 0);
    if (st.t.at && left <= 0) { tReset(st.t); goBeep(); el.textContent = "Go!"; el.className = "t"; $("restp").textContent = "Start rust"; persist(); updBar(); return; }
    if (st.t.at) { const s = Math.ceil(left); if (s !== st.lastSec) { if (s <= 3 && s >= 1) tickBeep(); st.lastSec = s; } }
    if (active) {
      el.textContent = fmt(Math.ceil(left)); el.className = "t"; $("restp").textContent = st.t.at ? "Pauze" : "Hervat";
      const k = st.checked.indexOf(false), s = b.sets[k];
      if (s) $("restlbl").textContent = `Rust · straks ${s.l}` + (numKg(s.kg) ? ` · ${kgNum(kgOf(b, st, k))} kg` : "");
    } else if (force) { el.textContent = fmt(b.rest); el.className = "t idle"; $("restp").textContent = "Start rust"; $("restlbl").textContent = `Rust tussen sets · ${fmt(b.rest)}`; }
    updProg(); return;
  }
  if (!timed(b)) return;
  const t = st.done ? totalDur(b) : tEl(st.t), L = locate(b, t);
  const cst = $("cst"), big = $("cbig"), sub = $("csub"), stn = $("cstation"), nxt = $("cnext");
  if (!cst) return;
  if (L.end || st.done) {
    if (!st.done) { finishBlock(st); return; }
    cst.textContent = "Blok klaar"; cst.className = "state ok"; big.className = "big"; big.textContent = b.type === "fortime" && st.ftime != null ? fmt(st.ftime) : "0:00";
    if (b.type === "amrap") sub.textContent = st.rounds + " rondes";
    else if (b.type === "fortime") sub.textContent = st.ftime != null ? "Jouw tijd" : "Tijdslimiet bereikt";
    else sub.textContent = "Tik Volgende";
    if (stn) stn.textContent = ""; if (nxt) nxt.textContent = "";
    updProg(); return;
  }
  const seg = L.seg, s = Math.ceil(L.left);
  if (st.t.at) {
    if (L.i !== st.lastSeg) { if (st.lastSeg !== -1 || L.i > 0) goBeep(); st.lastSeg = L.i; st.lastSec = s; }
    else if (s !== st.lastSec) { if (s <= 3 && s >= 1) tickBeep(); st.lastSec = s; }
  }
  cst.className = "state " + (seg.kind === "up" ? "work" : seg.kind);
  big.className = "big" + (seg.kind === "rest" ? " rest" : seg.kind === "prep" ? " prep" : "");
  const paused = st.t.at ? "" : "Pauze · ";
  if (seg.kind === "prep") {
    cst.textContent = st.t.at ? "Klaar maken" : (t > 0 ? "Gepauzeerd" : "Klaar?");
    big.textContent = fmt(s);
    if (b.type === "emom") { sub.textContent = "Minuut 1 / " + b.minutes; setNow(0); stn.textContent = b.stations[0]; nxt.textContent = "Daarna: " + b.stations[1 % b.stations.length]; }
    else if (b.type === "intervals") { sub.textContent = `${b.rounds} × ${b.work} s / ${b.rest} s`; stn.textContent = b.items[0] || ""; nxt.textContent = b.items[1] ? "Daarna: " + b.items[1] : ""; setNow(-1); autoIllu(b, st, 0); }
    else if (b.type === "amrap") sub.textContent = "Daarna " + b.minutes + ":00 aftellen";
    else sub.textContent = "Tijdslimiet " + b.cap + ":00";
  } else if (b.type === "intervals") {
    cst.textContent = paused + seg.label;
    big.textContent = fmt(s);
    sub.textContent = `Ronde ${seg.round + 1}/${b.rounds}`;
    stn.textContent = seg.item;
    nxt.textContent = seg.kind === "rest" ? "Komt eraan" : (seg.nextItem ? "Daarna: " + seg.nextItem : "Laatste ronde");
    setNow(seg.kind === "work" ? seg.round : -1);
    autoIllu(b, st, seg.kind === "work" ? seg.round : seg.round + 1);
  } else if (b.type === "emom") {
    cst.textContent = paused + "Werk";
    big.textContent = fmt(s);
    sub.textContent = seg.label;
    stn.textContent = seg.station;
    nxt.textContent = seg.last ? "Laatste minuut" : "Daarna: " + seg.nextSt;
    setNow(seg.min % b.stations.length);
  } else if (b.type === "amrap") {
    cst.textContent = st.t.at ? "AMRAP loopt" : "Gepauzeerd";
    big.textContent = fmt(s);
    sub.textContent = st.rounds + " rondes";
  } else if (b.type === "fortime") {
    cst.textContent = st.t.at ? "For time" : "Gepauzeerd";
    big.textContent = fmt(L.into);
    sub.textContent = "Tijdslimiet " + b.cap + ":00 · nog " + fmt(s);
  }
  updProg();
}
function setNow(k) { $("card").querySelectorAll(".moves li").forEach((li, j) => li.classList.toggle("now", j === k)); }
setInterval(() => { tick(false); if (anyRunning() && now() - lastPersist > 2000) persist(); }, 200);

/* ===== Samenvatting ===== */
function ivDone(b, st) {
  if (st.done) return b.rounds;
  const t = tEl(st.t); let acc = 0, n = 0;
  for (const x of segments(b)) { acc += x.dur; if (x.kind === "work" && acc <= t) n++; }
  return n;
}
function summaryLines(p, d) {
  p = p || P(); d = d || D();
  const L = [], wk = (PLAN.label || "").split("·")[0].trim();
  L.push(`${p.name} · ${wk} · ${dateTxt(d.finishedAt || now())} · totaal ${fmt(tEl(d.clock))}`);
  p.blocks.forEach((b, i) => {
    const st = d.blocks[i], fl = st.feel ? ` · gevoel: ${st.feel}` : "";
    L.push("");
    if (b.type === "sets") {
      const n = st.checked.filter(Boolean).length;
      L.push(`${b.phase.toUpperCase()} · ${b.title} — ${n}/${b.sets.length} sets${fl}`);
      if (rated(b) || b.sets.some(s => numKg(s.kg))) b.sets.forEach((s, k) => {
        const kg = numKg(s.kg) ? kgOf(b, st, k) : null;
        const w = kg != null ? ` · ${kgNum(kg)} kg${kg !== s.kg ? ` (gepland ${kgNum(s.kg)})` : ""}` : (s.kg === "lg" ? " · lichaamsgewicht" : "");
        L.push(`  ${s.l}: ${/^\d+$/.test(s.r) ? s.r + " reps" : s.r}${w} ${st.checked[k] ? "✓" : "✗ niet gedaan"}`);
      });
    } else if (b.type === "amrap") {
      L.push(`${b.phase.toUpperCase()} · ${b.title} — ${st.rounds} rondes${st.note ? " + " + st.note : ""}${fl}`);
      L.push("  Per ronde: " + b.moves.map(m => `${m[1]} ${m[0]}`).join(" · "));
    } else if (b.type === "fortime") {
      L.push(`${b.phase.toUpperCase()} · ${b.title} — ${st.ftime != null ? fmt(st.ftime) : (st.done ? "tijdslimiet " + b.cap + ":00 bereikt" : "niet gedaan")}${fl}`);
      L.push("  " + b.moves.map(m => `${m[1]} ${m[0]}`).join(" · "));
    } else if (b.type === "emom") {
      const m = st.done ? b.minutes : Math.max(0, Math.min(b.minutes, Math.floor((tEl(st.t) - PREP) / 60)));
      L.push(`${b.phase.toUpperCase()} · ${b.title} — ${m}/${b.minutes} min${fl}`);
      L.push("  Stations: " + b.stations.join(" · "));
    } else {
      L.push(`${b.phase.toUpperCase()} · ${b.title} — ${ivDone(b, st)}/${b.rounds} rondes${fl}`);
    }
    if (st.note && b.type !== "amrap") L.push("  Notitie: " + st.note);
  });
  if (d.notes) { L.push(""); L.push("Algemeen: " + d.notes); }
  return L;
}
function copyOrShare(txt, pre, toast, share) {
  const sel = () => { try { const rg = document.createRange(); rg.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); } catch (e) {} toast.textContent = "Geselecteerd — kopieer handmatig"; };
  if (share && navigator.share) { navigator.share({text: txt}).catch(() => {}); return; }
  try { navigator.clipboard.writeText(txt).then(() => { toast.textContent = "Gekopieerd"; }, sel); } catch (e) { sel(); }
}
function summaryHTML() {
  const d = D(), p = P();
  return `<div class="card"><div class="eyebrow"><span class="phase">Samenvatting</span></div><h2>${esc(p.name)} klaar</h2>
  <pre class="sumpre" id="sumtxt">${esc(summaryLines().join("\n"))}</pre>
  <label class="fld" for="dnote">Algemeen (energie, slaap, pijntjes)<textarea id="dnote">${esc(d.notes)}</textarea></label>
  <div class="foot"><button class="ghost" id="copy" type="button">Kopieer</button>${navigator.share && !window.__PLAN__ ? `<button class="ghost" id="share" type="button">Deel…</button>` : ""}<span class="toast" id="toast"></span></div></div>`;
}
function bindSummary() {
  const d = D();
  $("dnote").oninput = () => { d.notes = $("dnote").value; $("sumtxt").textContent = summaryLines().join("\n"); persist(); };
  $("copy").onclick = () => copyOrShare(summaryLines().join("\n"), $("sumtxt"), $("toast"), false);
  if ($("share")) $("share").onclick = () => copyOrShare(summaryLines().join("\n"), $("sumtxt"), $("toast"), true);
}

/* ===== Logboek: eerdere samenvattingen ===== */
function logHTML() {
  const H = lsGet(HIST_KEY), list = ((H && H.sessions) || []).slice().reverse();
  return `<div class="card"><div class="eyebrow"><span class="phase">Logboek</span></div><h2>Afgeronde trainingen</h2>` +
    (list.length ? list.map((x, i) => `<div class="logitem"><pre class="sumpre" id="lg${i}">${esc(x.text)}</pre>
      <div class="foot"><button class="ghost" type="button" data-lg="${i}">Kopieer</button><span class="toast" id="lt${i}"></span></div></div>`).join("")
      : `<p class="note">Nog niets. Een training komt hier te staan zodra je de samenvatting bereikt, en blijft staan als er een nieuw weekschema komt.</p>`) + `</div>`;
}
function bindLog() {
  const H = lsGet(HIST_KEY), list = ((H && H.sessions) || []).slice().reverse();
  $("card").querySelectorAll("[data-lg]").forEach(el => el.onclick = () => { const i = +el.dataset.lg; copyOrShare(list[i].text, $("lg" + i), $("lt" + i), false); });
}

/* ===== Levensloop van de pagina ===== */
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden") { persist(); return; }
  if (ac && ac.state !== "running") { try { ac.resume(); } catch (e) {} }
  if (anyRunning()) { keepAwake(); tick(true); return; }
  const p = await fetchPlan();                                   // nieuw weekschema binnen? Alleen wisselen als er niets loopt.
  if (p && planId(p) !== PID && !anyRunning()) usePlan(p);
});
window.addEventListener("pagehide", persist);

function installHint() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone || window.__PLAN__ || lsGet(HINT_KEY)) return;
  const el = $("hint"); el.hidden = false;
  el.innerHTML = `<span>Volledig scherm: tik in Safari op Deel en kies <b>Zet op beginscherm</b>.</span><button type="button">Sluit</button>`;
  el.querySelector("button").onclick = () => { el.hidden = true; lsSet(HINT_KEY, 1); };
}

(async function boot() {
  const p = await fetchPlan();
  if (!p || !p.days || !p.days.length) {
    $("weeklbl").textContent = "Geen schema";
    $("card").innerHTML = `<div class="card"><h2>Geen schema gevonden</h2><p class="note">Het weekschema kon niet geladen worden en er is nog geen eerdere versie bewaard. Controleer je verbinding en open de app opnieuw.</p></div>`;
    return;
  }
  usePlan(p); installHint();
  if ("serviceWorker" in navigator && location.protocol === "https:" && !window.__PLAN__) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
