# Runbook: Rollout auf den VPS

Für ein System, das bereits öffentlich läuft. Jeder Schritt trifft Bestandsdaten und
echte Besucher — die Reihenfolge ist nicht beliebig.

## Topologie — erst lesen, dann tippen

Auf dem mainserver stehen **zwei Caddy-Instanzen** hintereinander:

```
Besucher --> caddy (~/caddy, Ports 80/443, TLS, mehrere Domains)
             +-> kwms-caddy-1  (SPA + /api-Proxy, Alias "kwms-web" im Netz "web")
                 +-> kwms-backend-1  (kein Host-Port)
```

Der äußere Proxy setzt `header_up X-Forwarded-For {remote_host}` — er **überschreibt**,
was der Besucher mitschickt. Deshalb ist der Limit-Schlüssel nicht fälschbar, und
deshalb lässt sich die Trennung von außen nicht prüfen (Schritt 7).

Dazu liegt auf dem Server eine dritte Compose-Datei, die **nicht im Repo** ist:
`docker-compose.mainserver.yml`. Sie hängt `kwms-caddy-1` ins gemeinsame Netz `web`,
vergibt den Alias `kwms-web` und entfernt die Host-Ports. **Ohne sie verliert der
Deploy den Alias und die Seite ist offline.**

Alle Befehle laufen auf dem VPS im Projektverzeichnis. `PROD` steht für:

```bash
PROD="docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.mainserver.yml --profile public"
```

Der im README genannte Befehl **ohne** die dritte Datei gilt für einen frischen Klon,
nicht für diesen Server.

---

## 0. Backup — vor allem anderen

```bash
./scripts/backup.sh
ls -la backups/ | tail -3
```

**Abbruch, wenn** kein frischer Dump entstanden ist. Migration 0006 fasst `chunks`
an; ohne Sicherung gibt es keinen Weg zurück.

Das Restore-Verfahren steht in [restore.md](restore.md). Es ist auf dem VPS **noch
nicht** erprobt — dieser Rollout ist ein guter Anlass, das nachzuholen.

---

## 1. Code holen

```bash
git fetch origin && git log --oneline HEAD..origin/main | wc -l
git merge --ff-only origin/main
```

---

## 2. Caddy-Konfiguration

Der innere Caddyfile wird beim Bauen ins Image kopiert — er kommt aus dem Repo, dort
ist nichts abzugleichen.

Der **äußere** Proxy (`~/caddy/Caddyfile`) ist davon unberührt und setzt für
`wissen.jaekel.dev` bereits `X-Content-Type-Options` und `Referrer-Policy`. Der innere
setzt dieselben plus HSTS, CSP und `X-Frame-Options`. Caddys `header` ersetzt, statt
anzuhängen — doppelte Kopfzeilen entstehen nicht. In Schritt 8 gegenprüfen.

---

## 3. Vertrauensliste für X-Forwarded-For

uvicorn wertet den Header nur von Adressen aus `--forwarded-allow-ips` aus; der
Default deckt allein `127.0.0.1` ab.

**Auf dem mainserver ist das bereits erledigt:** `docker-compose.mainserver.yml` setzt
`--proxy-headers --forwarded-allow-ips=*`. Das `*` ist hier vertretbar, weil das
Backend keinen Host-Port hat und der äußere Proxy den Header ohnehin überschreibt.

Nur auf einem Server **ohne** diese Datei greift der Wert aus
`docker-compose.prod.yml` (`FORWARDED_ALLOW_IPS`, voreingestellt `172.16.0.0/12`).
Subnetz prüfen mit:

```bash
docker network inspect $(basename $PWD)_default --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

---

## 4. Gate — vor dem Neustart

```bash
$PROD exec -T backend python scripts/check_prod_ready.py
```

**Dieser Schritt steht bewusst vor dem Deploy.** Seit ADR-0022/Startup-Guard bricht
die App den Start ab, wenn der Index nicht zum konfigurierten Embedding-Modell passt
(Name **oder** Dimension). Das erfährt man besser hier als an einem Container, der
nicht mehr hochkommt.

**Abbruch, wenn** ein Check rot ist. Erwartete Checks: Korpus befüllt, Embeddings
passend, `APP_ENV=production`, Admin-Key stark, Mistral-Key gesetzt, Chat-Anbieter
konfiguriert, CORS ohne localhost, **Schreibrouten abgeschaltet**, EMBED_PROVIDER
ohne lokales Modell.

---

## 5. Migration

```bash
$PROD exec -T backend alembic upgrade head
$PROD exec -T backend alembic current
```

Erwartet: `0006_hot_path_indexes (head)`. Die Indizes entstehen mit
`CREATE INDEX CONCURRENTLY`, `chunks` wird dabei nicht für Schreibzugriffe gesperrt.

---

## 6. Deploy

Achtung: `./backend:/app` ist auch in Produktion gemountet (Compose führt
volumes-Listen zusammen; erst `!reset` entfernt sie — im Repo mit diesem Rollout
korrigiert). Der neue Code liegt nach `git merge` also bereits im Container, der
laufende uvicorn hält aber den alten. **Ein `restart` des Backends ist deshalb
nötig; das Backend-Image neu zu bauen dagegen nur bei geänderten Abhängigkeiten** —
es ist rund 10 GB groß.

```bash
$PROD build caddy          # traegt Frontend-Aenderungen und den Caddyfile
$PROD up -d --no-build caddy backend
$PROD restart backend      # laedt den neuen Code aus dem Mount
$PROD ps
$PROD logs backend --tail 30
```

Im Log muss die Startzeile stehen:

```
INFO  app.main: kwms <version> gestartet (env=production, embed=mistral/..., writes=False)
```

**Abbruch, wenn** stattdessen `IndexModelMismatch` erscheint — dann passt der Index
nicht, und Schritt 4 hätte das gemeldet.

---

## 7. Smoke-Test

```bash
BASE_URL=https://<domain>/api ./scripts/smoke_prod.sh
```

Die Prüfung der Rate-Limit-Trennung läuft **nicht** mit: von außen ist sie hier nicht
messbar, weil der äußere Proxy `X-Forwarded-For` überschreibt. Sie steht hinter
`CHECK_XFF=1` und gehört von innen ausgeführt — einen curl-Container ins Compose-Netz
hängen, den inneren Caddy (`http://caddy:80/api/documents`) mit zwei verschiedenen
`X-Forwarded-For`-Werten befragen. Erwartet: der erste Besucher läuft in 429, der
zweite bekommt **200**.

---

## 8. Header und CSP im Browser

```bash
curl -sD - -o /dev/null https://<domain>/ | grep -iE \
  'strict-transport|content-security|x-frame|x-content-type|referrer-policy'
```

Alle fünf müssen kommen. Danach die Seite im Browser öffnen und die Konsole ansehen:
**die CSP ist neu.** Sie wurde gegen das gebaute Bundle geprüft (kein Inline-Skript,
kein `eval`, keine Worker), aber die laufende Seite ist der letzte Beleg.

**Wenn die CSP etwas blockiert:** die betroffene Direktive im Caddyfile weiten, neu
ausrollen. Nicht die ganze Kopfzeile entfernen.

---

## 9. Nachher prüfen

```bash
# /graph: vorher 2,0 MB in ~2,5 s
curl -s -o /dev/null -w "graph %{http_code} %{size_download}B %{time_total}s\n" \
  https://<domain>/api/graph

# Schreibrouten müssen 404 liefern, auch mit Admin-Key
curl -s -o /dev/null -w "ingest %{http_code}\n" -X POST \
  "https://<domain>/api/ingest?filename=x.md" -H "X-API-Key: $ADMIN_API_KEY" --data-binary "# x"
```

Erwartet: `/graph` deutlich schneller, `ingest 404`.

---

## Zurückrollen

```bash
git merge --ff-only <vorheriger-stand>   # oder: git checkout <sha>
$PROD up -d --build
```

Die Migration muss dafür **nicht** zurückgenommen werden: 0006 legt nur Indizes an,
der alte Code kommt damit zurecht. Nur falls doch gewünscht:

```bash
$PROD exec -T backend alembic downgrade -1
```

Bei Datenschaden: [restore.md](restore.md).

---

## Danach offen

- **Uptime-Monitoring** auf `/api/health/db` einrichten. `/api/health` ist bewusst
  abhängigkeitsfrei und bleibt grün, während die Datenbank weg ist.
- **Prod-Cron** für `python -m app.update` aktivieren — mit `|| benachrichtigen`:
  der Lauf liefert jetzt einen Exit-Code ungleich 0, wenn etwas scheitert.
- **Restore-Drill** auf dem VPS durchspielen (steht laut PLAN §7 Phase 10 aus).
- **`PROMOTE_MIN_SOURCES`** steht auf 1. Ohne Review-Oberfläche (ADR-0023)
  entscheidet die Regel allein, was verifiziertes Wissen wird.
