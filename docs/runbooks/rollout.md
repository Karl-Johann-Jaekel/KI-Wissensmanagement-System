# Runbook: Rollout auf den VPS

Für ein System, das bereits öffentlich läuft. Jeder Schritt trifft Bestandsdaten und
echte Besucher — die Reihenfolge ist nicht beliebig.

Alle Befehle laufen auf dem VPS im Projektverzeichnis. `PROD` steht für:

```bash
PROD="docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile public"
```

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

## 2. Caddy-Konfiguration abgleichen

Die Datei im Repo wurde ergänzt (HSTS, CSP, X-Frame-Options, `request_body max_size`,
Asset-Caching). Sie enthält auch `Referrer-Policy` und `X-Content-Type-Options`, die
live gesetzt waren, aber im Repo fehlten.

```bash
git diff HEAD@{1} -- frontend/deploy/Caddyfile
```

**Prüfen, ob auf dem VPS Anpassungen liegen, die das Repo nicht kennt.** Von außen
war nur sichtbar, welche Header ankommen — nicht, was sonst in der Datei steht.

**Abbruch, wenn** der Diff etwas entfernt, das dort gebraucht wird.

---

## 3. Vertrauensliste für X-Forwarded-For

uvicorn wertet den Header nur von Adressen aus `--forwarded-allow-ips` aus; der
Default deckt allein `127.0.0.1` ab. Caddy ist ein eigener Container — deshalb zählte
das Rate-Limit bisher alle Besucher als einen.

```bash
docker network inspect $(basename $PWD)_default \
  --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

Liegt das Subnetz **nicht** in `172.16.0.0/12`, in die `.env` eintragen:

```
FORWARDED_ALLOW_IPS=<subnetz>
```

Kein `*`: sobald Port 8000 doch einmal veröffentlicht wird, wäre der Limit-Schlüssel
frei fälschbar.

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

```bash
$PROD up -d --build
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

Neu darin: eine Prüfung, ob zwei Besucher getrennte Rate-Limit-Eimer bekommen. Sie
schickt Anfragen mit unterschiedlichem `X-Forwarded-For` und erwartet, dass der
zweite Besucher **nicht** mitgesperrt wird. Schlägt sie fehl, stimmt Schritt 3 nicht.

Fällt der Test „unbestimmt" aus (kein 429 nach 40 Anfragen), ist `RATE_LIMIT` höher
als 40 — dann von Hand mit mehr Anfragen prüfen.

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
