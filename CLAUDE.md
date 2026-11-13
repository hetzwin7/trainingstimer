# Trainingstimer

Web-app (PWA) die Louis op zijn iPhone door zijn twee krachtavonden leidt. Staat online via GitHub Pages:
https://hetzwin7.github.io/trainingstimer/ — Pages serveert de branch `gh-pages`. Houd `main` en `gh-pages`
altijd gelijk: `git push origin HEAD:main HEAD:gh-pages`.

## Wat staat waar
- `plan.json` — het weekschema. **Dit is het enige bestand dat wekelijks verandert.**
- `app.js`, `app.css`, `index.html` — de vaste app. Niet aanpassen bij een weekupdate.
- `figures.js` — bibliotheek met stokfiguren (`FIG`) en de koppeling naam → figuur (`FIGMAP`). Alleen aanvullen, nooit iets verwijderen.
- `sw.js` — offline-cache. Bij een nieuw bestand: toevoegen aan `FILES` en `CACHE` ophogen.
- `tools/check.py` — controle vóór elke push (schema + rooktest met Playwright). Moet zonder FOUTEN eindigen.

## plan.json
```
{ "week": 47, "year": 2026, "label": "Week 47 · 16 – 22 nov 2026", "figs": {}, "figmap": [],
  "days": [ { "id": "ma", "weekday": 1, "label": "Maandag", "sub": "korte omschrijving op de dagknop",
              "name": "Maandag · Naam van de avond", "focus": "één regel", "gear": ["klaarzetlijst"], "blocks": [ ... ] } ] }
```
- `week` is het ISO-weeknummer; de app bewaart voortgang per `year`+`week` en waarschuwt als het niet de lopende week is.
- `weekday`: 1 = maandag … 7 = zondag. De app opent op de laatste dag die al begonnen is.
- `phase` is exact "Warming-up", "Hoofddeel", "Metcon" of "Cooldown". Hoofddeel en Metcon krijgen de knoppen "Hoe zwaar was dit?".
- Bloktypen:
  - `intervals`: `rounds`, `work`, `rest` (seconden), `workLabel`, `restLabel`, `items` (precies één per ronde).
  - `sets`: `rest` (seconden), `sets: [{ "l": "Set 1", "r": "5", "kg": 50 }]`, optioneel `log: true` voor een notitieveld.
    `kg` als getal geeft −/+ knoppen (2,5 kg; de stap schuift de nog niet gedane sets mee); lichaamsgewicht is `"kg": "lg"`.
    **`key`** is verplicht bij gewichten: de vaste, kleine-letter naam van de oefening ("deadlift", "back squat", "complex").
    Gebruik elke week dezelfde key voor dezelfde oefening; daarop toont de app "Vorige keer".
  - `emom`: `minutes`, `stations`. `amrap`: `minutes`, `moves`. `fortime`: `cap` (minuten), `moves`.
    `moves` zijn paren `["Hang power clean · 30 kg", "8"]`; gewichten staan in de tekst.
- Geen `scale`-veld: lichtere alternatieven worden niet getoond.
- `note` per blok is optioneel; houd het kort, een blok moet op één iPhone-scherm passen.

## Tekeningen
Bij `intervals` toont de app de tekening en uitleg van de lopende oefening; "links"/"rechts" in de naam spiegelt de tekening.
Elke rek- en mobiliteitsoefening in warming-up en cooldown moet een tekening hebben (`tools/check.py` meldt wat ontbreekt).
Nieuwe figuur: entry in `FIG` (viewBox 200×120, vloer y=110, kijkrichting rechts; `h` = hoofd, `l` = polylines,
optioneel `f` = lichte lijnen, `x` = extra SVG met classes ob/ar/band/mat, `d` = uitleg in gewone taal) plus een regel in `FIGMAP`.
Render een nieuwe tekening en bekijk hem voordat je pusht.
