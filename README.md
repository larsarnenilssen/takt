# Takt

Takt samler turnusen, reisen til og fra jobb og det du vil huske, dag for dag.
Appen er laget for turnusarbeidere og kan brukes av hvem som helst: adresser,
arbeidssted, vaktkoder og navn legges inn i appen. Hun som bruker den, kan også
koble den til Døgn, slik at hun ser hva som skjer hjemme, og Døgn ser vaktene
og når hun er borte.

Appen er en nettside som legges på hjemskjermen og virker uten nett. Alt du legger
inn, lagres på telefonen din. Andre som åpner samme adresse, får sin egen, tomme app.

## Innhold

- **Vakt:** dagens vakt, uken og når du er borte hjemmefra. Trykk på vakten for å endre
  den for én dag: en annen kode, ingen vakt eller egne tider (byttet vakt, kurs).
- **Turnus fra PDF:** kalenderplanen fra GAT leses på telefonen, også når den er skannet.
  Før noe lagres, viser Takt hvilke koder den fant, med bilder fra planen, og rutene som
  var vanskelige å lese. Nye koder får tider i samme kontroll.
- **Reise:** reiser med Skyss til og fra vakten, med gange til og fra holdeplassene. Til
  vakt vises den siste reisen som er fram i tide; hjem den første etter at vakten er
  slutt. Favorittlinjer (for eksempel 16E, 20 eller 1 + 5) vises først. **Velg** en reise
  for dagen, så brukes den til å regne ut når du er borte.
- **Hjemme** (valgfritt): dagen i Døgn – hvem som sover, hva som skjer nå og snart,
  middag og avtaler.
- **Notater og gjøremål:** gjøremål, avtaler, notater og ting som skal kjøpes. Punkter
  merket «delt» vises i Døgn, og handling havner på handlelisten der.
- **Måned:** turnusen i kalender, med ukenummer.

## Filer

| Fil eller mappe | Hva den gjør |
|---|---|
| `index.html` | Siden som åpnes |
| `styles/tokens.css` | Alle farger, tekststørrelser, avstander og hjørner, i et lyst og et mørkt sett |
| `styles/app.css` | Oppsett og utseende, bygget på verdiene i `tokens.css` |
| `js/text.nb.js` | All tekst som vises i appen |
| `js/version.js` | Versjonsnummer og listen over filer som lagres for bruk uten nett |
| `js/migrate.js`, `js/store.js` | Datastruktur, oppgradering og kontroll av data, lagring og angre |
| `js/domain/` | Regler: turnus, steder, reiser (Entur), notater, hjemme (Døgn) og backup/deling |
| `js/import/` | Lesing av turnus fra PDF: finne tabellen, lese rutene, tekstgjenkjenning |
| `js/views/` | Det som vises: siden, arkene og sveiping |
| `js/app.js` | Knapper og oppstart |
| `sw.js` | Gjør at appen virker uten nett |
| `vendor/` | pdf.js og Tesseract for PDF-import (se `vendor/README.md`) |
| `docs/deling.md` | Formatet på filene som deles med Døgn |
| `tests/` | Automatiske tester og en oppdiktet turnus-PDF |

Last aldri opp turnus-PDF-er, backupfiler eller andre personlige filer hit. Repoet er offentlig.

## 1. Legg den på hjemskjermen (Android)

1. Åpne `https://<brukernavn>.github.io/takt/` i **Chrome**.
2. Trykk menyen (⋮) → **Installer app** (eller **Legg til på startsiden**).
3. Bruk alltid appen fra ikonet. Da åpnes den i full skjerm, og tilbakeknappen lukker ark i appen.

Første gang kommer et kort oppsett: navn, hjem og arbeidssted (søk etter adresse, eller stå ved
inngangen og trykk **Bruk der jeg er nå**), minutter før og etter vakten, og import av turnus.

## 2. Turnus

**Mer › Turnus › Importer turnus (PDF).** Velg kalenderplanen. Lesingen tar noen sekunder.

- **Se over** viser ruter som var vanskelige å lese, med bildet fra planen. Rett koden om den er feil.
- **Koder i planen** viser hver kode med bilder av rutene. Skriv en annen kode for å rette hele gruppen.
  Nye koder må få tider (eller merkes Fri) før du kan publisere.
- **Ta med fra** bestemmer hvor den nye turnusen begynner. **Behold dager jeg har endret selv** står på.

Vaktkodene kan endres under **Mer › Turnus › Vaktkoder**. **Del turnusfil** lager en fil kolleger kan
importere under **Importer turnusfil**. Døgn leser den samme filen.

## 3. Backup og deling med Døgn (valgfritt)

Takt bruker det samme private repoet som Døgn (for eksempel `dogn-data`). Hver app skriver bare sine
egne filer, se `docs/deling.md`.

1. Lag en egen tilgangsnøkkel for telefonen hennes: profilbildet på github.com → **Settings →
   Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - Navn: `Takt`. Utløp: for eksempel 1 år.
   - **Repository access → Only select repositories** → `dogn-data`.
   - **Permissions → Repository permissions → Contents → Read and write**.
   - **Generate token**, og kopier nøkkelen (starter med `github_pat_`).
2. I Takt: **Mer › Backup og deling med Døgn**. Fyll inn brukernavn, repo og nøkkel, og trykk **Koble til**.

Takt tar da backup (høyst én gang i timen), sender turnus, fravær og delte punkter til Døgn, og henter
dagen hjemme hvert femte minutt mens appen er åpen. Hvert valg kan slås av. Nøkkelen lagres bare på
telefonen. Mister hun telefonen, slettes nøkkelen på GitHub under samme meny.

Merk: Den som eier repoet, kan lese alle filene i det, også backupen.

På ny telefon: installer appen, velg **Hent fra GitHub** i oppsettet og koble til med en nøkkel.

## 4. Reise

**Mer › Steder og reise.** Her står hjem, arbeidssted og andre steder, minutter før og etter vakten,
ganghastighet, reisetid én vei og favorittlinjer. Reisene hentes fra Entur, som har rutene og
sanntiden til Skyss. **Endre sted** på reisen gjelder bare den dagen, for eksempel et kurs et annet sted.

Når du er borte, regnes ut fra: 1) reisen du har valgt for dagen, 2) reisetiden du har skrevet inn,
3) den raskeste reisen Takt har funnet.

## Oppdateringer

Appen henter ny versjon neste gang den åpnes med nett. Dataene berøres ikke. Endres datastrukturen,
oppgraderes dataene automatisk første gang den nye versjonen åpnes.

## For den som vil endre appen

- **Tekst:** All tekst står i `js/text.nb.js`. Bokmål med felleskjønn (-en). Tekster som tar inn verdier, er små funksjoner.
- **Farger og størrelser:** Bare i `styles/tokens.css`. `app.css` bruker bare disse variablene.
- **Endringer i data** går alltid gjennom `commit()` i `js/store.js`: lagrer, merker for backup og deling, tegner på nytt og kan angres.
- **HTML** lages med `h`…`` fra `js/util.js`, som escaper alle verdier. Alt som leses inn, kontrolleres av `sanitize()` i `js/migrate.js`.
- **Ny fil:** Legg den inn i `index.html` og i `APP_FILES` i `js/version.js`. Øk `APP_VERSION` ved hver utgivelse.
- **Deling med Døgn:** Endringer i filformatet beskrives i `docs/deling.md` i begge repoene.
- **Tester:** `python3 -m unittest discover -s tests -v` (krever `pip install playwright` og
  `python -m playwright install chromium`). Testene kjøres også på GitHub under **Actions** ved hver endring.
  De sjekker også at det ikke finnes ubrukte funksjoner, tekster, fargevariabler eller CSS-klasser,
  og at fillisten for bruk uten nett er komplett.
- **Testplanen** i `tests/fixtures` lages med `python3 tests/make_fixture.py` og er oppdiktet.
