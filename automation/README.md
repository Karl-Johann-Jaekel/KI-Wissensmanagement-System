# n8n Automation (PLAN §7 Phase 7 / §8 Phase 8)

n8n runs in the compose `full` profile (no credentials committed — PLAN §2).

```bash
docker compose --profile full up -d n8n     # http://localhost:5678
```

Set these in n8n (**Settings → Variables** or the container env) so the workflows
can reach the backend:

- `KWMS_API_BASE` — e.g. `http://backend:8000` (inside the compose network) or
  `http://host.docker.internal:8000`
- `KWMS_ADMIN_KEY` — the backend `ADMIN_API_KEY` (needed for `/ingest`)

## Workflows

### `ingest-webhook.workflow.json` — new PDF → indexed, no manual step
Import via **Workflows → Import from File**. It exposes a webhook that forwards an
uploaded PDF straight to the backend's `/ingest` (idempotent, admin-gated):

```
POST http://localhost:5678/webhook/ingest-pdf?filename=paper.pdf&sensitivity=public
Content-Type: application/pdf
<raw PDF bytes>
```

After activating the workflow, dropping a PDF at that URL makes it queryable via
`/chat` / `/search` / MCP without any manual ingest command (Phase 7 DoD).

### `living-knowledge-cron.workflow.json` — weekly recursive update loop
A **Schedule** trigger (weekly) runs the end-to-end loop
(`app.update`: delta-fetch → ingest → LLM-extract → promote → eval). The command
form uses n8n's Execute Command node; on a server run n8n with access to the compose
project, or replace it with a plain host cron:

```cron
# weekly, Monday 03:00 — delta-fetch + extract + promote + eval
0 3 * * 1 cd /srv/kwms && docker compose exec -T backend python -m app.update --since "$(date -d '7 days ago' +%F)" --cap 5
```

Each run writes a JSON report to `eval/reports/` (Hit-Rate@5 + counts) as an artifact.


## Stand dieser Workflows

`ingest-webhook.workflow.json` wurde entfernt: sein Ziel `POST /ingest` ist in
Produktion abgeschaltet (ADR-0024), und der Aufruf trug noch den mit ADR-0015
entfallenen `sensitivity`-Parameter.

`living-knowledge-cron.workflow.json` ist ein **Beispiel, kein lauffähiger Stand**:
der `executeCommand`-Knoten ruft `docker compose exec`, aber der n8n-Container
mountet weder den Docker-Socket noch das Projektverzeichnis, und
`KWMS_API_BASE`/`KWMS_ADMIN_KEY` werden ihm nicht übergeben. Produktionspfad ist der
Host-Cron (ADR-0009) — mit `|| benachrichtigen`, denn `app.update` liefert seit
Kurzem einen Exit-Code ungleich 0, wenn im Lauf etwas scheitert.
