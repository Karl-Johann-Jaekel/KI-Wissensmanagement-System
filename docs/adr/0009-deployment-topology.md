# ADR-0009: Deployment-Topologie (öffentlicher Betrieb)

Datum: 2026-08-03 · Status: akzeptiert

## Kontext

Phase 10 bringt das System auf einen EU-VPS (public-Zone, PLAN §7 Phase 9 alt).
Das neue Frontend ist eine SPA mit Router (Deep-Links) und sprach bisher
cross-origin mit dem Backend; der Frontend-Container war ein Dev-Server.

## Entscheidung

**Ein Caddy-Container** (Compose-Profil `public`, Multi-Stage-Target `prod`
in `frontend/Dockerfile`) übernimmt drei Rollen:

1. **TLS** — automatisches Let's Encrypt über `SITE_ADDRESS` (Domain);
   `:80` als Default für lokale Tests.
2. **Statische SPA** — `vite build` mit `VITE_API_BASE=/api` (Build-Arg),
   SPA-Fallback `try_files {path} /index.html` für Router-Deep-Links.
3. **Reverse-Proxy** — `/api/*` → `backend:8000` (strip_prefix). Frontend und
   API sind same-origin ⇒ CORS ist in Produktion irrelevant.

`docker-compose.prod.yml` härtet das Basis-Setup: Backend ohne `--reload`,
ohne Quellcode-Bind-Mounts und ohne Host-Port (nur via Caddy erreichbar);
Postgres ohne Host-Port. Admin-Endpoints bleiben wie gehabt hinter
`X-API-Key`; öffentlich nutzbar sind nur `/graph`, `/search`, `/chat`
(public-Scope), `/documents` (public-Liste) und `/health`.

**Update-Loop produktiv:** Host-Cron auf dem VPS (`docker compose exec -T
backend python -m app.update …`) statt n8n — n8n liefe sonst nur für einen
einzigen Cron-Job als Dauer-Container mit eigener Angriffsfläche. Der
n8n-Workflow (`automation/living-knowledge-cron.workflow.json`) bleibt als
Alternative für das `full`-Profil dokumentiert.

## Verworfen

- **nginx statt Caddy:** zweites TLS-Werkzeug (certbot) nötig; Caddy macht
  ACME nativ und ist bereits im Stack-Plan (PLAN §4).
- **Separater Frontend- und Proxy-Container:** mehr bewegliche Teile ohne
  Nutzen bei dieser Größe.
