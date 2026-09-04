# Architekturentscheidungen

Eine Datei je Entscheidung, fortlaufend nummeriert (ADR-0001 legt das Verfahren
fest). Der Kopf jeder Datei nennt Datum, Status und die ADRs, die sie ergänzt oder
ablöst.

Status: **akzeptiert** · **teilweise überholt** — der Kern gilt, ein Teil wurde
abgelöst · **überholt** — die Entscheidung trägt nicht mehr. Überholte ADRs bleiben
stehen: der Verlauf ist die Auskunft.

| ADR | Entscheidung | Stand |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | ADRs als Verfahren für Abweichungen von PLAN.md | akzeptiert |
| [0002](0002-embedding-model.md) | Ein Embedding-Modell für Index und Query | akzeptiert |
| [0003](0003-in-process-hardening.md) | Rate-Limit und Token-Deckel im Prozess statt als Abhängigkeit | akzeptiert |
| [0004](0004-remove-github-portfolio-track.md) | GitHub-Portfolio-Track entfernt | akzeptiert |
| [0005](0005-frontend-dependencies.md) | Frontend-Abhängigkeiten für das Redesign | akzeptiert |
| [0006](0006-client-side-persistence.md) | Chats, Skills, Projekte nur im Browser (DSGVO) | akzeptiert |
| [0007](0007-document-content-and-editing.md) | `content_md` speichern, Markdown bearbeitbar | teilweise überholt (0024) |
| [0008](0008-model-override.md) | Modellwahl je Anfrage, admin-gated | überholt (0015) |
| [0009](0009-deployment-topology.md) | Caddy für TLS, SPA und `/api`-Proxy | akzeptiert, mit Nachtrag |
| [0010](0010-review-throughput.md) | Sammelfreigabe und konfigurierbare Schwellen | teilweise überholt (0022, 0023) |
| [0011](0011-docling-ocr-off.md) | Docling-OCR aus (Speicher-Peak) | akzeptiert |
| [0012](0012-canonical-entity-names.md) | `canonical_key` als Identität statt Anzeigename | akzeptiert |
| [0013](0013-citation-metrics.md) | Zitationszahlen als Qualitätssignal | akzeptiert |
| [0014](0014-embedding-provider-split.md) | Embedding-Anbieter wählbar (lokal oder EU-API) | akzeptiert |
| [0015](0015-remove-confidential-zone.md) | Zwei-Zonen-Architektur entfernt | akzeptiert |
| [0016](0016-graph-explorer.md) | Graph-Explorer mit vier Layouts | akzeptiert |
| [0017](0017-external-sources.md) | Papers-with-Code als Adapter in dieselben Tabellen | akzeptiert |
| [0018](0018-source-harvesters.md) | OAI-PMH-Harvester mit Backoff und Dedup | akzeptiert |
| [0019](0019-grobid-reference-parsing.md) | GROBID als optionaler zweiter Parser | akzeptiert |
| [0020](0020-provenance-schema.md) | Provenienz als Tabellen statt JSONB-Feld | akzeptiert |
| [0021](0021-groq-chat-with-mistral-fallback.md) | Groq antwortet, Mistral ist Rückfallebene | akzeptiert |
| [0022](0022-promotion-counts-provenance.md) | Promotion zählt Belege, nicht das JSONB-Feld | akzeptiert |
| [0023](0023-review-ui-removed.md) | Review-Oberfläche entfernt, die Regel trägt allein | akzeptiert |
| [0024](0024-disable-write-routes-in-production.md) | Schreibrouten in Produktion abgeschaltet | akzeptiert |
| [0025](0025-wissensbasis-hive-view.md) | Wabenansicht als Einstieg in die Wissensbasis | akzeptiert |
| [0026](0026-node-scoped-chat.md) | Chat am Knoten bindet das Thema serverseitig | akzeptiert |

Betriebsanleitungen liegen daneben in [../runbooks/](../runbooks/).
