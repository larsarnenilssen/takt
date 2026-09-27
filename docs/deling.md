# Deling mellom Takt og Døgn (format versjon 1)

Takt og Døgn deler data gjennom et privat GitHub-repo (se `github.md`).
Hver app skriver bare sine egne filer. Derfor kan ingen av dem overskrive det
den andre har lagret, og ingen endringer må flettes sammen. Tilgangsnøkler
står aldri i filene.

| Fil | Skrives av | Leses av | Når |
|---|---|---|---|
| `takt-backup.json` | Takt | Takt (gjenoppretting) | Høyst én gang i timen etter endringer |
| `takt-deling.json` | Takt | Døgn | Omtrent 20 sekunder etter endringer i turnus, reiser eller delte punkter, og én gang per dag |
| `dogn-backup.json` | Døgn | Døgn (gjenoppretting) | Høyst én gang i timen etter endringer |
| `dogn-deling.json` | Døgn | Takt | Høyst hvert femte minutt, og raskere når barna sovner eller våkner |

Begge apper kontrollerer alt de leser, og bruker bare feltene som står her.
Ukjente felt ignoreres, så nye felt kan legges til uten å øke versjonen.
Endres betydningen av et felt, økes `v`.

Alle datoer skrives som `ÅÅÅÅ-MM-DD` og alle klokkeslett som `TT:MM`, i lokal tid.

## takt-deling.json

```json
{
  "format": "takt-deling", "v": 1, "updated": "2026-10-05T06:02:11.000Z", "name": "Kari",
  "rota": {
    "codes": { "D": { "label": "Dagvakt", "kind": "work", "start": "07:00", "end": "15:00" } },
    "shifts": { "2026-10-05": "D" },
    "custom": { "2026-10-09": { "start": "08:00", "end": "12:00", "label": "Kurs" } }
  },
  "away": {
    "2026-10-05": { "leave": "06:00", "back": "15:48", "backDay": 0, "chosenTo": true, "chosenHome": false, "basis": "fastest" }
  },
  "items": [
    { "id": "k3j9x0a1", "kind": "shop", "date": "", "time": "", "title": "Bleier", "note": "", "done": false }
  ]
}
```

- `rota.codes`: vaktkodene. `kind` er `work` (vakt), `night` (natt, slutter neste dag) eller `off` (fri).
- `rota.shifts`: koden hver dag, med endringer gjort for hånd i Takt. Dager uten vakt er ikke med.
- `rota.custom`: dager med egne tider (byttet vakt, kurs). Disse går foran `shifts`.
- `away`: når hun er borte hjemmefra på vaktdager, fra en uke tilbake til tre måneder fram.
  `leave` er når hun går hjemmefra, `back` når hun er hjemme igjen, og `backDay` er antall
  dager etter datoen hun kommer hjem (1 etter nattevakt). `chosenTo` og `chosenHome` er `true`
  når hun har valgt reisen den veien. Ellers er tiden beregnet: vakten ± tiden før/etter vakten
  ± reisetid, der reisetiden er den hun har skrevet inn (`basis: "set"`) eller den raskeste
  reisen Takt har funnet (`basis: "fastest"`).
- `items`: punkter hun har merket «delt». `kind` er `todo`, `appt`, `note` eller `shop`.
  Et punkt uten `date` gjelder til det er gjort. `shop` legges på handlelisten i Døgn.

## dogn-deling.json

```json
{
  "format": "dogn-deling", "v": 1, "updated": "2026-10-05T05:55:00.000Z",
  "kidsWord": "barna", "kids": [{ "id": "a", "name": "Per" }, { "id": "b", "name": "Pål" }],
  "usual": { "a": { "night": 690, "wakes": 1, "nap": 110 }, "b": { "night": 660, "wakes": 1, "nap": 95 } },
  "days": {
    "2026-10-05": {
      "blocks": [{ "start": "08:15", "end": "08:45", "title": "Frokost", "type": "meal", "meal": "Havregrøt" }],
      "sleep": [{ "kid": "a", "start": "09:20", "end": "", "night": false }],
      "nights": { "b": { "asleep": "21:00", "wake": "04:30", "net": 450, "wakes": 5, "up": 0 } },
      "meals": [{ "title": "Lunsj", "start": "11:30", "rates": { "a": "godt", "b": "lite" } }],
      "did": [{ "start": "10:30", "name": "Lekeplassen" }],
      "health": [{ "kid": "b", "time": "13:50", "kind": "temp", "value": "38,6" }],
      "note": { "text": "Falt på lekeplassen, går fint nå.", "important": false },
      "flags": [{ "kind": "fever", "level": "high", "kid": "b", "temp": 38.6, "time": "13:50" }],
      "lastLog": "13:50",
      "dinner": { "dish": "Fiskegrateng", "partnerEats": true },
      "appts": [{ "title": "Helsestasjon", "start": "13:00", "where": "Bydelshuset" }],
      "sick": ["Pål"]
    }
  },
  "shop": ["Melk"],
  "acks": { "k3j9x0a1": { "done": true } }
}
```

- `usual`: det vanlige per barn, snittet de siste 14 dagene: søvn om natten (`night`, minutter uten
  tiden våken), oppvåkninger (`wakes`) og lurer i alt (`nap`, minutter). `null` når færre enn 7 er logget.
- `days`: i går, i dag og i morgen.
- `blocks`: dagens bolker med tidene slik de står nå (etter forskyvning), `type` som i Døgn
  (`prep`, `meal`, `sleep`, `awake`, `routine`), og `meal` med retten der det finnes.
- `sleep`: lurer og natt som er logget. `end` er tom så lenge barnet sover. `night: true`
  er nattesøvnen som starter den kvelden.
- `nights`: natten som slutter denne dagen, per barn: sovnet, våknet, søvn i minutter (`net`,
  0 før «våknet» er logget), oppvåkninger og minutter våken.
- `meals`: måltider som er vurdert, med `godt`, `middels` eller `lite` per barn.
- `did`: aktiviteter som er valgt for dagen.
- `health`: temperatur (`temp`), medisin (`med`), symptom (`sym`) og annet (`other`), med klokkeslett.
- `note`: notatet i dagsloggen, bare når det er merket «Vis i Takt» (`important: false`) eller
  «Viktig» (`important: true`). Ellers `null`.
- `flags`: det som skiller seg ut, viktigst først. `level` er `high` (rød) eller `note` (gul).
  Reglene står i Døgn (`dayFlags` i `js/domain/takt.js`); Takt viser dem bare.
  - `fever` (`high`): temperatur fra 38,0, med `temp` og `time` for den høyeste.
  - `sick` (`high`): merket syk uten feber.
  - `med` (`note`): siste medisin, med `time` og `what`.
  - `night`: søvn under 80 % av det vanlige (`high` under 60 %), minst 3 flere oppvåkninger
    enn vanlig, eller minst en time våken. Med `net`, `wakes` og `usual`.
  - `nap` (`note`): lurene til sammen under 60 % av det vanlige når lurtiden er over, med `total` og `usual`.
  - `food` (`note`): minst to måltider med «lite», med `count`.
- `lastLog`: siste klokkeslett noe ble logget den dagen (søvn, natt, helse), eller tom.
- `dinner.partnerEats`: om Døgn regner med at hun er hjemme til middag.
- `sick`: navnene på barn som er merket syke.
- `shop`: varer som står på handlelisten og ikke er kjøpt.
- `acks`: punkter fra Takt som er krysset av i Døgn.
