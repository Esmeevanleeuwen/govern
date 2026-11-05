# GhostSketch: dictafoon en notities, Govern: bronopslag

GhostSketch blijft in [zijn eigen repository](https://github.com/Esmeevanleeuwen/GhostSketch).
Daar neem je op, importeer je telefoonopnames, transcribeer je lokaal en koppel je
het gesprek aan automatische notities. Govern bewaart de oorspronkelijke audio en
transcripties in PostgreSQL. `/dictation.php` toont die gegevens; het is geen recorder
of transcriptiescherm. De GhostSketch-browser heeft geen Govern-login nodig.

## Inrichten op Windows

Behoud bestaande wachtwoorden, gegevens en volumes. Stel in Govern `.env` in:

```dotenv
PG_ENABLED=1
PG_SCHEMAS=public,brainstorm
STUDIO_ENABLED=1
STUDIO_SCHEMA=brainstorm
GHOSTSKETCH_STORAGE_TOKEN=<willekeurige-sleutel-van-minstens-32-tekens>
```

Behoud bestaande schema's in `PG_SCHEMAS`. De Studio-configuratienaam blijft voor
compatibiliteit; het oude whiteboard hoeft niet gebruikt te worden. Maak een sleutel
met `python -c "import secrets; print(secrets.token_urlsafe(32))"` en bewaar deze alleen
in de lokale `.env`-bestanden. Zet de sleutel niet in Git of een browser-URL.

Start Govern met `.\start.cmd` en voer `.\scripts\provision-studio.cmd` uit.
Op Linux/macOS: `sh start.sh` en `sh scripts/provision-studio.sh`. Dit voegt het
opnamearchief toe en past de transcriptlimiet aan, met behoud van bestaande data.
De Govern-app-image bevat ffmpeg/ffprobe om uploads als echte audio te controleren.
Voor deze koppeling draait de spraakservice bij GhostSketch, niet bij Govern.

Stel in GhostSketch `.env` in:

```dotenv
GHOSTSKETCH_GOVERN_URL=http://127.0.0.1:8080/ghostsketch-storage.php
GHOSTSKETCH_GOVERN_TOKEN=<dezelfde-sleutel>
GHOSTSKETCH_WHISPER_URL=http://127.0.0.1:8081
```

Herstart beide apps. Configureer GhostSketchs lokale whisper.cpp-server met een
zelf geïnstalleerd meertalig model volgens de GhostSketch README. M4A/MP3 vereisen
ook ffmpeg op de computer waarop GhostSketch draait. Er is geen cloudfallback.

## Gebruiken

1. Open een notitieboek in GhostSketch. Kies **Importeren → Audio-opname** of
   **Neem gesprek op**. WAV, M4A en MP3 worden ondersteund: maximaal 16 MiB en
   30 minuten per bestand. Live opnemen verstuurt zelfstandige WAV-fragmenten.
2. GhostSketch bewaart de audio eerst in Govern. Daarna transcribeert de lokale
   GhostSketch-spraakservice de opname en bewaart het transcript in Govern.
3. GhostSketch voegt de tekst en automatische notitievoorstellen toe aan je pagina,
   met opname-ID, transcript-ID en checksum als bronverwijzing.
4. Bij een transcriptiefout blijft de opname in Govern. Open **Opnames** in
   GhostSketch om opnieuw te transcriberen en een pagina te maken. Reeds voltooide
   opnames kun je daar ook openen zonder opnieuw te transcriberen.

Dezelfde upload wordt op checksum herkend. Een voltooid transcript is onveranderlijk;
herhalen met dezelfde inhoud is veilig, een andere inhoud geeft een conflict.
Een oudere gedeeltelijke transcriptie wordt niet overschreven. Voltooide oudere
transcripties met meerdere fragmenten blijven via **Opnames** importeerbaar.

## Opslag en toegang

`_govern_dictation_recordings` bewaart audio, checksum en voortgang.
`_govern_dictation_segments` bewaart de transcripties. De views `dictation_recordings`
en `dictation_transcripts` tonen brongegevens in Govern.

`ghostsketch-storage.php` is een afgebakende serverkoppeling met een aparte Bearer-
sleutel. Die geeft alleen toegang tot het ingestelde opnamearchief: audio uploaden,
teruglezen en transcripties toevoegen. Geen willekeurige SQL of databasekeuze.
De oude `dictation-feed.php` met `GHOSTSKETCH_READ_TOKEN` blijft optioneel alleen-lezen
beschikbaar. Die sleutel kan niet uploaden of transcriberen.

Notitieboeken, eigen tekst, kaarten en tekeningen blijven in GhostSketchs lokale
SQLite-opslag; de bronopnames en oorspronkelijke transcripties staan in Govern.
Een notitieboek verwijderen verwijdert geen bronopname. Maak van beide opslagen
back-ups: een GhostSketch JSON-export bevat geen audio en een Docker-volume is
geen back-up. De verbinding werkt in deze versie op dezelfde computer via loopback.
