# Runbook: Datenbank-Restore

Ziel: ein `scripts/backup.sh`-Dump (`backups/kwms-YYYY-MM-DD.dump`,
pg_dump Custom-Format) vollständig zurückspielen. DoD Phase 10 verlangt,
dass dieser Ablauf **einmal real** durchgespielt und unten protokolliert wird.

## Ablauf (Drill und Ernstfall identisch)

```bash
# 1. Stack stoppen (Backend darf während des Restores nicht schreiben)
docker compose stop backend caddy

# 2. Restore in die laufende Postgres-Instanz (-c = Objekte vorher droppen)
docker compose exec -T postgres pg_restore -U kwms -d kwms -c --if-exists \
  < backups/kwms-YYYY-MM-DD.dump

# 3. Backend wieder hoch + Migrationen abgleichen (no-op wenn Dump aktuell)
docker compose start backend caddy
docker compose exec -T backend alembic upgrade head

# 4. Verifikation
docker compose exec -T backend python scripts/check_prod_ready.py
BASE_URL=http://localhost/api ./scripts/smoke_prod.sh
```

Totalverlust des Volumes: vorher `docker volume rm <projekt>_pgdata` und
`docker compose up -d postgres` (leere Instanz), dann ab Schritt 2.

## Hinweise

- `pg_restore -c --if-exists` ersetzt alle Objekte — kein manuelles DROP nötig.
- Der Dump enthält auch die pgvector-Daten; die Extension selbst wird von
  Migration 0001 bzw. dem Dump angelegt.
- Chats/Skills/Projekte liegen client-seitig (ADR-0006) und sind vom
  DB-Restore nicht betroffen.

## Drill-Protokoll

| Datum | Dump | Ergebnis | Dauer | Durchgeführt von |
|---|---|---|---|---|
| 2026-08-03 | kwms-2026-08-03.dump (9,3 MB) | ✓ grün — 16 Dokumente / 1801 Chunks / 95 Graph-Knoten vor und nach Restore identisch; /health + /graph ok | < 1 min | Claude Code (lokaler Stack) |
| _beim ersten Prod-Deploy auf dem VPS wiederholen_ | | | | |
