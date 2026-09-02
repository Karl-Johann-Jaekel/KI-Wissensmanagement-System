# ADR-0008: Per-Request-Modellwahl (Ollama) & Modell-Liste

Datum: 2026-08-03 · Status: überholt — die Zwei-Zonen-Idee entfiel mit ADR-0015, der `/models`-Endpunkt besteht nicht mehr

## Kontext

Die Bibliothek (confidential-Zone) soll Nutzern die Wahl des lokalen
Ollama-Modells erlauben. Bisher kam das Modell ausschließlich aus der
Konfiguration (`OLLAMA_LLM_MODEL`); es gab keinen Endpoint, der installierte
Modelle auflistet.

## Entscheidung

1. **`GET /models`** (admin-only, rate-limited) proxied Ollama `/api/tags`
   (5 s Timeout, 60 s In-Process-Cache). Ollama nicht erreichbar ⇒
   `{"available": false, "models": []}` statt 500. Admin-only, weil die Liste
   lokale Infrastruktur offenlegt und nur Admin-Flows sie nutzen.
2. **`ChatRequest.model`** (optional): Override **nur mit Admin-Key** (401
   sonst — verhindert anonymes Modell-Probing). Der Zonen-Router bleibt
   unangetastet: das Override wirkt ausschließlich, wenn der Router ohnehin
   einen **Ollama**-Client wählt; bei Mistral (public + API-Key) wird es
   ignoriert. Zonensicherheit hängt damit nie an der Modellwahl.
3. **Validierung:** gegen die gecachte Tags-Liste (400 bei unbekanntem
   Modell). Ist Ollama gerade nicht erreichbar (Liste unbekannt), wird nicht
   künstlich abgelehnt — der Stream schlägt dann ohnehin fehl.
4. `choose_client(zone, *, settings=None, model=None)` bleibt für den
   bestehenden positionalen Aufruf in `app/update.py` kompatibel.
5. Das SSE-`sources`-Event enthält jetzt `model` + `provider`, damit das UI
   transparent zeigt, welches Modell geantwortet hat.
