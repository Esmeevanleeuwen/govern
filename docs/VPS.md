# Govern op een VPS met HTTPS

Deze route voegt een eigen HTTPS-adres toe aan een al werkende Govern-installatie.
Dezelfde accounts, databases en herstelpunten blijven in dezelfde Docker-volumes.
Caddy ontvangt bezoekers op poort 80/443 en vraagt het TLS-certificaat aan. De
bestaande gateway, app, phpMyAdmin en databases blijven daarachter staan.

De voorbeelden gebruiken `govern.example.nl`. Vervang dat door je eigen gekozen
adres, zonder `https://`, poortnummer of pad. De configuratie verandert geen DNS
bij je provider en voert niets op een andere server uit.

## Waar voer je de opdrachten uit?

**Windows PowerShell op je laptop** gebruik je om met SSH te verbinden:

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519" gebruikersnaam@JOUW_VPS_IP
```

Na het verbinden voer je de onderstaande Linux-opdrachten in de terminal van
je **Ubuntu-VPS** uit. Een prompt met `PS C:\Users\...>` hoort nog bij Windows;
een prompt zoals `gebruikersnaam@server:~$` hoort bij de VPS.

Voor een nieuwe Ubuntu 26.04-installatie zijn Git, Docker Engine en Compose
beschikbaar als Ubuntu-pakketten:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
newgrp docker
```

Controleer daarna `docker --version` en `docker compose version`. De host heeft
geen afzonderlijke PHP-, Node-, MariaDB- of PostgreSQL-installatie nodig.

## Begin met een bestaande eigenaar

Heb je Govern al gestart en het eerste account via je SSH-tunnel aangemaakt?
Ga dan verder met de DNS-stap. Anders start je eerst de gewone lokale configuratie
op de VPS:

```bash
git clone --branch integrate/all-govern-updates https://github.com/Esmeevanleeuwen/govern.git
cd govern
sh start.sh
```

Open een tweede PowerShell-venster op je laptop voor de tijdelijke verbinding:

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8081:127.0.0.1:8080 gebruikersnaam@JOUW_VPS_IP
```

Houd dat venster open en bezoek `http://localhost:8081`. Maak het eerste account
voor deze VPS-installatie aan en controleer dat je de werkplek kunt openen.
Een account uit een afzonderlijke Windows-installatie wordt niet automatisch
naar de VPS gekopieerd.

De VPS-start controleert of er al een actieve installatie-eigenaar bestaat.
Zonder die eigenaar start de publieke HTTPS-ingang niet. De controle maakt geen
account aan en vraagt geen wachtwoord via de shell. Deze installatieaccounts
geven gedeelde toegang tot de toegestane werkdatabases; ze vormen geen afzonderlijke
klantomgevingen of privé-databases per gebruiker.

## Kies en bewaar het DNS-record

Bij TransIP open je **Domein & Hosting → je domein → DNS**. Voor een subdomein
`govern.example.nl` gebruik je:

| Naam | Type | Waarde |
| --- | --- | --- |
| `govern` | `A` | Het IPv4-adres van jouw VPS |

Wil je Govern direct op `example.nl`, dan is de naam voor dat record `@`.
Kies de naam die bij het bedoelde adres hoort. Bewaar je wijziging met **DNS
Opslaan**. Het instellen van een `govern`-record verandert het hoofddomein of
`www` niet. Bestaande mailrecords zoals MX, SPF, DKIM en DMARC blijven behouden.

Controleer een eventueel bestaand `AAAA`-record voor precies dezelfde host:
dat moet naar het juiste IPv6-adres van je VPS wijzen. Een oud IPv6-record kan
bezoekers naar een andere server sturen. Nieuwe of gewijzigde DNS-antwoorden
kunnen nog een tijd in caches staan. Met bijvoorbeeld
`Resolve-DnsName govern.example.nl -Type A` in PowerShell zie je welk adres
je computer momenteel ontvangt.

TCP-poorten **80 en 443** moeten de VPS kunnen bereiken voor HTTPS en de
certificaatcontrole. Houd je bestaande SSH-toegang bereikbaar. Controleer zowel
de TransIP-VPS-firewall als een eventuele firewall op Ubuntu. Als UFW al actief
is, kunnen deze regels de webpoorten toestaan:

```bash
sudo ufw status
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Het startscript verandert geen firewall, SSH-instellingen of DNS-records.
Poort 8080 blijft aan `127.0.0.1` gebonden; de databases krijgen geen openbare
poorten.

## Start de HTTPS-configuratie

Voer dit uit in de bestaande Govern-map op de VPS:

```bash
cd ~/govern
git pull --ff-only
sh scripts/start-vps.sh govern.example.nl
```

Het script controleert de domeinnaam, Docker en de bestaande eigenaar. Daarna
bewaart het `GOVERN_DOMAIN`, vult het zo nodig ontbrekende PostgreSQL-wachtwoorden
aan in `.env` en start het
`compose.yaml` samen met `compose.vps.yaml`. Het behoudt wachtwoorden,
onbekende instellingen, accounts en data. Een al ingeschakelde PostgreSQL-
configuratie blijft meedoen.

Bij `PG_ENABLED=1` vult de VPS-start ontbrekende wachtwoorden voor
`PG_READ_PASSWORD`, `PG_PASSWORD` en `PG_ADMIN_PASSWORD` aan. Dit gebeurt pas na
de eigenaarcontrole, ook bij een update van een oudere PostgreSQL-installatie
zonder schrijfwachtwoord. Bestaande waarden in `.env` blijven exact behouden;
een expliciet meegegeven omgevingswachtwoord wordt niet vervangen of naar het
bestand gekopieerd. Lege omgevingswaarden maskeren de bewaarde wachtwoorden niet.
De gegenereerde waarden blijven bij herhaald starten behouden en worden niet
afgedrukt.

De eigenaarcontrole gebruikt een tijdelijke PHP-container met het bestaande
accountvolume, zonder webpoorten of afhankelijke services te starten. Daardoor
werkt dezelfde start ook wanneer de gewone app-container gestopt is.

Na de configuratiecontrole worden de gateway en Caddy expliciet herladen, ook
wanneer alleen hun gekoppelde configuratiebestanden veranderd zijn. Caddy vraagt
automatisch een certificaat aan wanneer DNS en poort 80/443 kloppen. De
sluittekst van het script bevestigt de configuratie, niet dat publieke DNS of
certificaatuitgifte al geslaagd is. Open daarna:

```text
https://govern.example.nl
```

Log in met het bestaande VPS-account. Door het andere webadres krijg je een
nieuwe browsersessie. Het account zelf blijft hetzelfde. De SSH-tunnel is voor
dit HTTPS-adres niet nodig; je SSH-verbinding blijft bruikbaar voor beheer.

De HTTPS-proxy stuurt alleen naar de afzonderlijke interne gatewaypoort voor
de ingestelde domeinnaam. Daar staat het protocol vast op HTTPS. De gewone
loopbackroute blijft zijn eigen HTTP-protocol gebruiken. App, accountcontrole
en officiële phpMyAdmin ontvangen zo dezelfde zichtbare host en hetzelfde
protocol, zonder een willekeurige browserheader als vertrouwensbron te gebruiken.

## Bijwerken en bewaren

Na de eerste VPS-start kun je bijwerken met:

```bash
cd ~/govern
git pull --ff-only
sh start.sh
```

De normale Unix-start herkent de bewaarde `GOVERN_DOMAIN` en gebruikt dan opnieuw
de VPS-configuratie. Je kunt ook expliciet `sh scripts/start-vps.sh` uitvoeren.
Een foutieve domeininstelling geeft een fout; er wordt niet stilletjes naar een
andere configuratie overgeschakeld.

Caddy bewaart certificaten en zijn beheerdata in eigen Docker-volumes en vernieuwt
certificaten automatisch zolang domein en webpoorten bereikbaar blijven. Bewaar
ook `.env`, `account_data`, de databasevolumes en je herstelpunten. Een VPS-snapshot
of Docker-volume is geen onafhankelijke, geteste databaseback-up. Maak een
afzonderlijke kopie buiten deze VPS en controleer of herstel werkt.
Accountherstel per e-mail en wachtwoordreset zijn geen onderdeel van Govern;
bewaar de toegang tot het eigenaarsaccount.

## Als het adres niet opent

Controleer eerst DNS en poort 80/443. Lees daarna op de VPS de recente meldingen:

```bash
docker compose -f compose.yaml -f compose.vps.yaml logs --tail=80 caddy gateway
```

Een startup- of configuratiefout stopt alleen de publieke Caddy-service. Accounts,
databases, volumes en SSH blijven staan. Voer na het oplossen hetzelfde
VPS-startscript opnieuw uit. Je kunt de publieke ingang ook tijdelijk stoppen:

```bash
docker compose -f compose.yaml -f compose.vps.yaml stop caddy
```

De bewaarde domeininstelling blijft dan aanwezig; een volgende start zet de
HTTPS-service opnieuw aan.

## Gecontroleerde grenzen

De startupfixtures controleren validatie, bestaande eigenaar, instellingenbehoud,
PostgreSQL, configuratievolgorde en stoppen van alleen de publieke ingang bij
fouten. De HTTPS-integratieproef gebruikt een afzonderlijke lokale testinstallatie.
Een echte publieke DNS-wijziging, TransIP-firewall, certificaataanvraag en installatie
op de VPS van een gebruiker blijven afzonderlijke uitvoerstappen.
