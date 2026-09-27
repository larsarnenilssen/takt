# Backup og deling via GitHub (avansert)

Valget er skjult i appen. Vanlige brukere ser bare Google Drive og fil under **Backup**, og ingen spor av
GitHub, Døgn, deling eller handleliste.

## Vise valget på en telefon

Åpne appen én gang med `?github` bak adressen, for eksempel `https://<brukernavn>.github.io/takt/?github`.
Telefonen husker det, og GitHub vises da under **Mer › Backup** og i første steg av oppsettet. Telefoner som
allerede er koblet til GitHub, ser valget uansett.

## Koble til

Takt kan bruke det samme private repoet som Døgn. Hver app skriver bare sine egne filer, se `deling.md`.

1. Lag en egen tilgangsnøkkel for telefonen: profilbildet på github.com → **Settings →
   Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - Navn: `Takt`. Utløp: for eksempel 1 år.
   - **Repository access → Only select repositories** → det private repoet.
   - **Permissions → Repository permissions → Contents → Read and write**.
   - **Generate token**, og kopier nøkkelen (starter med `github_pat_`).
2. I Takt: **Mer › Backup › Backup og deling med Døgn**. Fyll inn brukernavn, repo og nøkkel, og trykk **Koble til**.

Takt tar da backup (høyst én gang i timen), sender turnus, fravær og delte punkter til Døgn, og henter
dagen hjemme hvert femte minutt mens appen er åpen. Hvert valg kan slås av. Først når henting fra Døgn er
slått på, vises kortet **Hjemme** og typen **Handling**; bryteren **Del med …** på punkter vises bare når
deling er slått på. Nøkkelen lagres bare på telefonen. Merk: Den som eier repoet, kan lese alle filene i
det, også backupen.

Fine-grained-nøkler utløper. Skriv inn utløpsdatoen når du kobler til (den står på GitHub), så varsler Takt
på forsiden to uker før. Slutter GitHub å virke, vises det også på forsiden. En ny nøkkel limes inn under
**Tilgangsnøkkel** i samme meny; resten beholdes.
