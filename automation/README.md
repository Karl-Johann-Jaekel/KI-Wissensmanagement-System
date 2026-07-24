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

> The Phase 8 living-knowledge loop (delta-fetch → extract → review) will be added
> here as a **Schedule**-triggered workflow.
