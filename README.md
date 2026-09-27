# Takt

Takt samler turnusen, reisen til og fra jobb og det du vil huske, dag for dag.
Appen er laget for turnusarbeidere og kan brukes av hvem som helst: adresser,
arbeidssted, vaktkoder og navn legges inn i appen.

Appen er en nettside som legges på hjemskjermen og virker uten nett. Alt du legger
inn, lagres på telefonen din. Andre som åpner samme adresse, får sin egen, tomme app.

## Innhold

- **Vakt:** dagens vakt, uken og når du er borte hjemmefra. Trykk på vakten for å endre
  den for én dag: en annen kode, ingen vakt eller egne tider (byttet vakt, kurs).
- **Turnus:** importer kalenderfilen fra MinGat, kalenderplanen fra GAT som PDF (leses på telefonen, også skannet), eller skriv den inn uke for uke.
  Før noe lagres, viser Takt hvilke koder den fant, med bilder fra planen, og rutene som
  var vanskelige å lese. Nye koder får tider i samme kontroll.
- **Reise:** reiser med Skyss til og fra vakten, med gange til og fra holdeplassene. Til
  vakt vises den siste reisen som er fram i tide; hjem den første etter at vakten er
  slutt. Favorittlinjer (for eksempel 16E, 20 eller 1 + 5) vises først. **Velg** en reise
  for dagen, så brukes den til å regne ut når du er borte.
- **Notater og gjøremål:** gjøremål, avtaler og notater, for en dag eller til de er gjort.
- **Måned:** turnusen i kalender, med ukenummer.
- **Kalender** (valgfritt): vaktene, og avtaler som er merket for det, i en egen kalender i Google-kalenderen,
  eller som kalenderfil (.ics).

## Filer

| Fil eller mappe | Hva den gjør |
|---|---|
| `index.html` | Siden som åpnes |
| `styles/tokens.css` | Alle farger, tekststørrelser, avstander og hjørner, i et lyst og et mørkt sett |
| `styles/app.css` | Oppsett og utseende, bygget på verdiene i `tokens.css` |
| `js/text.nb.js` | All tekst som vises i appen |
| `js/version.js` | Versjonsnummer og listen over filer som lagres for bruk uten nett |
| `js/migrate.js`, `js/store.js` | Datastruktur, oppgradering og kontroll av data, lagring og angre |
| `js/config.js` | Klient-ID for Google Drive (se «For den som legger ut appen») |
| `js/domain/` | Regler: turnus, steder, reiser (Entur), notater, kalender, backup til Google Drive og GitHub |
| `js/import/` | Lesing av turnus fra PDF: finne tabellen, lese rutene, tekstgjenkjenning |
| `js/views/` | Det som vises: siden, arkene og sveiping |
| `js/app.js` | Knapper og oppstart |
| `sw.js` | Gjør at appen virker uten nett |
| `vendor/` | pdf.js og Tesseract for PDF-import (se `vendor/README.md`) |
| `docs/` | Oppsett av GitHub-backup (`github.md`) og formatet på filene som deles (`deling.md`) |
| `personvern.html` | Hva som lagres hvor |
| `tests/` | Automatiske tester og en oppdiktet turnus-PDF |

Last aldri opp turnus-PDF-er, backupfiler eller andre personlige filer hit. Repoet er offentlig.

## 1. Legg den på hjemskjermen (Android)

1. Åpne `https://<brukernavn>.github.io/takt/` i **Chrome**.
2. Trykk menyen (⋮) → **Installer app** (eller **Legg til på startsiden**).
3. Bruk alltid appen fra ikonet. Da åpnes den i full skjerm, og tilbakeknappen lukker ark i appen.

Første gang kommer et kort oppsett: navn, hjem og arbeidssted (søk etter adresse, eller stå ved
inngangen og trykk **Bruk der jeg er nå**), minutter før og etter vakten, import av turnus og backup.
Har du brukt Takt før, velger du **Hent fra Google Drive** eller **Hent fra fil** i første steg.

## 2. Turnus

**Mer › Turnus › Importer fra MinGat.** I MinGat: **Min kalender**, åpne innstillingene og trykk **Eksporter**. Filen (.ics)
havner i Nedlastinger på telefonen; velg den i Takt. Vaktkoden leses fra tittelen på hver vakt, og tidene som er vanligst for
en kode, blir kodens tider. Dager med andre tider får egne tider. Filen er et øyeblikksbilde: eksporter og importer på nytt
når turnusen endres. Dager du har endret selv, beholdes om du vil.

**Mer › Turnus › Skriv inn turnus.** Et rutenett med én rad per uke, som arket fra turnuskontoret. Velg en kode
og trykk på dagene, eller dra vannrett over en uke. **Uker i runden** og **Gjenta ut perioden** fyller resten av perioden
med samme runde, så trenger du bare å rette avvikene. Mangler en kode, lages den med **+ Ny kode** uten å miste det du har
fylt inn. Rutenettet viser vaktene slik de er nå, så det kan også brukes til å rette en periode.

**Mer › Turnus › Importer turnus (PDF).** Velg kalenderplanen. Lesingen tar noen sekunder.

- **Se over** viser ruter som var vanskelige å lese, med bildet fra planen. Rett koden om den er feil.
- **Koder i planen** viser hver kode med bilder av rutene. Skriv en annen kode for å rette hele gruppen.
  Nye koder må få tider (eller merkes Fri) før du kan publisere.
- **Ta med fra** bestemmer hvor den nye turnusen begynner. **Behold dager jeg har endret selv** står på.

Vaktkodene kan endres under **Mer › Turnus › Vaktkoder**. **Del turnusfil** lager en fil kolleger kan
importere under **Importer turnusfil**.

## 3. Backup

Alt lagres på telefonen. Under **Mer › Backup** velger hver bruker selv hvordan det tas backup:

- **Google Drive (anbefalt):** Trykk **Backup til Google Drive**, velg en kode og logg inn med Google.
  Takt lagrer en kryptert backup i en skjult app-mappe i brukerens egen Google Drive, og ser bare den
  mappen. Backup tas automatisk når det er endringer, høyst én gang i timen og når appen legges bort.
  Innloggingen varer omtrent en time; har den gått ut og endringer har ventet i tre dager, ber appen om
  ett trykk for å logge inn igjen. På ny telefon: velg **Hent fra Google Drive** i oppsettet, skriv koden
  og logg inn. **Uten koden kan backupen ikke leses.**
- **Fil:** **Lagre backup som fil** åpner delingsmenyen på telefonen, så filen kan legges i Drive, sendes
  på e-post eller lagres i Filer. **Hent backup fra fil** leser den inn igjen. Har brukeren ingen backup,
  minner appen om det etter to uker.
- **GitHub (avansert):** Backup til et privat GitHub-repo. Valget er skjult i appen; se `docs/github.md`.

Se også [personvern.html](personvern.html).

## 3b. Vaktene i kalenderen

**Mer › Kalender.** To valg:

- **Google-kalender:** Takt lager en egen kalender, «Takt – vakter», og holder den lik turnusen: én hendelse per
  vakt med vaktens lengde (ikke fridager), og avtaler fra Takt som er merket **Legg i kalenderen** (standard).
  Det går én vei: endringer gjøres i Takt. Takt ser bare kalendere den selv har laget. Før innloggingen forklarer
  Takt at Google kan vise «Google har ikke bekreftet denne appen», hvorfor, og hvilke valg brukeren har.
- **Kalenderfil:** En .ics-fil med det samme, fra to uker tilbake og ett år fram, til å åpne i kalenderappen eller
  importere på calendar.google.com. Den oppdateres ikke av seg selv.

## 4. Reise

**Mer › Steder og reise.** Her står hjem, arbeidssted og andre steder, minutter før og etter vakten,
ganghastighet, reisetid én vei og favorittlinjer. Reisene hentes fra Entur, som har rutene og
sanntiden til Skyss. **Endre sted** på reisen gjelder bare den dagen, for eksempel et kurs et annet sted.

Når du er borte, regnes ut fra: 1) reisen du har valgt for dagen, 2) reisetiden du har skrevet inn,
3) den raskeste reisen Takt har funnet.

## For den som legger ut appen: Google Drive

Backup til Google Drive krever at appen er registrert hos Google (en klient-ID). Registreringen
gjøres én gang av den som eier nettadressen, er gratis, og gir ingen tilgang til brukernes data.
Uten klient-ID vises ikke valget. Skjermbildene hos Google endres av og til; navnene under kan avvike litt.

1. Gå til **console.cloud.google.com** og logg inn. Velg **Opprett prosjekt** (New project), kall det `Takt`.
2. **APIs & Services › Library** → søk etter **Google Drive API** → **Enable**. Gjør det samme for
   **Google Calendar API** (for vaktene i kalenderen).
3. **Google Auth Platform** (OAuth consent screen) → **Get started**: app-navn `Takt`, e-post for
   brukerstøtte, målgruppe **External**, kontakt-e-post → **Create**.
4. **Data access** → **Add or remove scopes** → legg til `https://www.googleapis.com/auth/drive.appdata`
   (ikke-sensitiv) og `https://www.googleapis.com/auth/calendar.app.created` → **Save**.
   Kalendertilgangen regnes som sensitiv. Til appen er bekreftet av Google, ser brukerne en advarsel ved
   innlogging til kalenderen (Takt forklarer den), og appen kan ha høyst 100 brukere. Drive-backupen påvirkes ikke.
5. **Branding**: legg inn startside `https://<brukernavn>.github.io/takt/` og personvernside
   `https://<brukernavn>.github.io/takt/personvern.html`.
6. **Audience** → **Publish app** (In production). I testmodus må hver bruker legges inn for hånd, og
   innloggingen slutter å virke etter sju dager.
7. **Clients** → **Create client** → type **Web application**, navn `Takt`.
   - **Authorized JavaScript origins:** `https://<brukernavn>.github.io`
   - **Authorized redirect URIs:** `https://<brukernavn>.github.io/takt/`
   - **Create**, og kopier **Client ID** (slutter på `.apps.googleusercontent.com`). Klient-ID-en er ikke
     hemmelig. Det lages også en «client secret»; den brukes ikke og skal ikke legges noe sted.
8. Lim klient-ID-en inn i `js/config.js` (`const GOOGLE_CLIENT_ID = '…';`), øk `APP_VERSION` i
   `js/version.js`, og last opp.

## Oppdateringer

Appen henter ny versjon neste gang den åpnes med nett. Dataene berøres ikke. Endres datastrukturen,
oppgraderes dataene automatisk første gang den nye versjonen åpnes.

## For den som vil endre appen

- **Tekst:** All tekst står i `js/text.nb.js`. Bokmål med felleskjønn (-en). Tekster som tar inn verdier, er små funksjoner.
- **Farger og størrelser:** Bare i `styles/tokens.css`. `app.css` bruker bare disse variablene.
- **Endringer i data** går alltid gjennom `commit()` i `js/store.js`: lagrer, merker for backup og deling, tegner på nytt og kan angres.
- **HTML** lages med `h`…`` fra `js/util.js`, som escaper alle verdier. Alt som leses inn, kontrolleres av `sanitize()` i `js/migrate.js`.
- **Ny fil:** Legg den inn i `index.html` og i `APP_FILES` i `js/version.js`. Øk `APP_VERSION` ved hver utgivelse.
- **Filformat for deling:** Endringer beskrives i `docs/deling.md`.
- **Tester:** `python3 -m unittest discover -s tests -v` (krever `pip install playwright` og
  `python -m playwright install chromium`). Testene kjøres også på GitHub under **Actions** ved hver endring.
  De sjekker også at det ikke finnes ubrukte funksjoner, tekster, fargevariabler eller CSS-klasser,
  og at fillisten for bruk uten nett er komplett.
- **Testplanen** i `tests/fixtures` lages med `python3 tests/make_fixture.py` og er oppdiktet.
