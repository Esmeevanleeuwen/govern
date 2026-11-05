# Dictafoon als bron voor GhostSketch

Govern bewaart de oorspronkelijke opnames en transcripties. GhostSketch blijft
in [zijn eigen repository](https://github.com/Esmeevanleeuwen/GhostSketch) en
beheert notitieboeken, secties, pagina's, automatische aantekeningen en tekeningen.
De browser van GhostSketch hoeft geen Govern-venster of Govern-login open te houden.

## Inrichten op Windows

Behoud bestaande wachtwoorden, gegevens en volumes. Stel in de Govern-`.env` in:

```dotenv
PG_ENABLED=1
PG_SCHEMAS=public,brainstorm
STUDIO_ENABLED=1
STUDIO_SCHEMA=brainstorm
GHOSTSKETCH_READ_TOKEN=<zelfgekozen-willekeurige-sleutel-van-minstens-32-tekens>
```

Behoud andere bestaande schema's in `PG_SCHEMAS`. De bestaande Studio-naam is
voorlopig een compatibele configuratienaam voor het bronschema, geen vereiste om
het oude whiteboard te gebruiken. Maak een willekeurige sleutel bijvoorbeeld met
`python -c "import secrets; print(secrets.token_urlsafe(32))"`. Zet die alleen in
beide lokale `.env`-bestanden, nooit in Git of een browser-URL.

Start Govern met `.\start.cmd`; voer vervolgens
`.\scripts\provision-studio.cmd` uit. Op Linux/macOS gebruik je `sh start.sh`
en `sh scripts/provision-studio.sh`. De provisioning past de bestaande foundation
toe en voegt de afzonderlijke dictatietabellen toe zonder whiteboards te wissen.
De app-image bevat ffmpeg en ffprobe voor audiodecodering.

Gebruik de bestaande transcriptieprovider uit [STUDIO.md](STUDIO.md), inclusief
het zelf geïnstalleerde meertalige model en de Compose-aanvulling. Een ingestelde
provider is geen garantie dat het model bereikbaar is. Er is geen cloudfallback.

Open `http://localhost:8080/dictation.php`, log in en laad een M4A-, WAV- of
MP3-opname uit Dictafoon in. Audio wordt echt gedecodeerd en daarna met checksum
in PostgreSQL bewaard. Deze eerste route accepteert maximaal 16 MiB en 30 minuten.
Kies **Transcriptie starten / hervatten**. De browser verwerkt achtereenvolgens
zes seconden per verzoek. Afgeronde fragmenten blijven bewaard als je stopt of
als de provider uitvalt. Hervatten begint bij het volgende opgeslagen fragment.
Een herhaalde upload van hetzelfde bestand opent de bestaande opname.

## Verbinding met GhostSketch

Stel in de aparte GhostSketch-`.env` in:

```dotenv
GHOSTSKETCH_GOVERN_URL=http://127.0.0.1:8080/dictation-feed.php
GHOSTSKETCH_GOVERN_TOKEN=<dezelfde-willekeurige-sleutel>
```

Herstart GhostSketch. Open een notitieboek en kies **Uit Govern** op een pagina.
Een gereed transcript wordt een nieuwe pagina. De bestaande Nederlandse tekstregels
of het expliciet gekozen lokale Ollama-model maken automatische voorstellen.
Herhaald ophalen opent dezelfde pagina en bewaart eigen wijzigingen en penstreken.

De koppeling gebruikt een aparte alleen-lezen sleutel. Die kan uitsluitend de
lijst en inhoud van transcripties uit het ingestelde schema ophalen. Geen SQL,
accountbeheer, opname-upload of audiobestanden via deze feed. De sleutel komt niet
in de GhostSketch-frontend. Roteren: wijzig beide `.env`-bestanden en herstart
beide apps. Er is nog geen sleutelbeheer per gebruiker. De koppeling is gedeeld
op installatieniveau en de eerste client ondersteunt alleen lokale loopback-HTTP.

## Opslag en herstel

`_govern_dictation_recordings` bewaart de audio en importvoortgang;
`_govern_dictation_segments` de oorspronkelijke transcriptfragmenten. De views
`dictation_recordings` en `dictation_transcripts` maken de brongegevens zichtbaar
in de gewone Govern-catalogus, zonder audiobytes in de weergave. Selecteer daarvoor
de PostgreSQL-database en het `brainstorm`-schema.

De bestaande PostgreSQL-schemaherstelpunten omvatten ook de opnames. Ze groeien
daarom mee met het opnamearchief. Een Docker-volume is geen backup. GhostSketch
bewaart een herleidbare transcriptkopie met Govern-adres, opname-ID, fragment-ID,
checksum en tijdsgrenzen naast de eigen notities. De audiobron blijft in Govern.
Bestaande `/studio.php`-whiteboards blijven voor compatibiliteit beschikbaar;
ze worden niet automatisch overgezet of verwijderd. Live synchronisatie tussen
telefoon en laptop en automatisch ophalen van nieuwe opnames zijn vervolgstappen.
