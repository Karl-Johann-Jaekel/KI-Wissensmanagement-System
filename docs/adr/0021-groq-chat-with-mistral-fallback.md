# ADR-0021: Groq für Antworten, Mistral als Rückfallebene

Datum: 2026-09-01 · Status: akzeptiert · Ergänzt ADR-0009, ADR-0014, ADR-0015

## Kontext

Der öffentliche Betrieb auf `wissen.jaekel.dev` steht an. Die Demo läuft auf einem
Portfolio, nicht in einem Produkt mit Umsatz — die laufenden Kosten sollen deshalb
gegen null gehen, ohne dass die Antwortqualität sichtbar leidet.

Bestandsaufnahme der Kosten je RAG-Zug (Systemprompt plus fünf Chunks, rund 3.000
Token hinein, 300 hinaus):

| Modell | hinein | hinaus | je Zug | 10 $ reichen für |
|---|---|---|---|---|
| `mistral-medium-latest` | 1,50 $/M | 7,50 $/M | ~0,0068 $ | ~1.470 Züge |
| `mistral-small-latest` | 0,15 $/M | 0,60 $/M | ~0,0006 $ | ~15.800 Züge |
| `mistral-embed` | 0,10 $/M | — | ~0,000005 $ | praktisch unbegrenzt |
| Groq `openai/gpt-oss-120b` (freier Tarif) | — | — | 0 $ | wenige tausend Token/Minute, je Organisation |

Der Consumer-Plan von Mistral enthält 10 $ API-Guthaben im Monat. Das trägt die
Demo, ist aber ein Budget und keine Flatrate.

**Groq ist kein vollständiger Ersatz.** Es hat keinen `/v1/embeddings`-Endpunkt,
und der Bestand trägt `mistral-embed` (ADR-0002, ADR-0014). Ein Mistral-Schlüssel
bleibt also in jedem Fall nötig — nur ist der Embedding-Anteil mit 20 bis 50 Token
je Suche praktisch kostenlos. Teuer ist allein die Antwort.

Groqs freier Tarif hat dafür eine harte Kante: wenige tausend Token je Minute, und
zwar **je Organisation**, nicht je Schlüssel. Bei 2.000 bis 4.000 Token je Zug sind
das zwei bis vier Fragen pro Minute, dann HTTP 429. Dieselbe Wand ist beim
Sprachassistenten-Projekt bereits aufgeschlagen — das dasselbe Groq-Konto nutzt und
sich das Kontingent damit teilt.

**Modellwahl innerhalb von Groq:** `openai/gpt-oss-120b`. Erste Wahl war
`llama-3.3-70b-versatile`, weil die gpt-oss-Reihe Token für internes „reasoning"
verbraucht, bevor Inhalt entsteht. Das Konto hat die Llama-Modelle aber nicht
freigeschaltet — `GET /v1/models` listet nur die gpt-oss-Reihe, alles andere
antwortet mit 404 `model_not_found`. **Die Modellliste je Konto weicht von der
öffentlichen Doku ab und gehört vor dem Setzen gegengeprüft.**

Zwischen den beiden verbliebenen entscheidet der Verbrauch: auf dieselbe Frage
(85 Token Prompt) brauchte `gpt-oss-120b` 145 Completion-Token für einen
vollständigen Satz, `gpt-oss-20b` lief bei 200 in den Deckel und brach ab.

## Entscheidung

**Groq beantwortet, Mistral steht dahinter.**

1. `GroqChatClient` neben `MistralChatClient`. Beide sprechen das OpenAI-Format
   (`/v1/chat/completions`, SSE) und teilen sich `_OpenAICompatChatClient`; sie
   unterscheiden sich nur in Adresse, Name und Modell. Groqs Basis ist
   `https://api.groq.com/openai` — das `/openai` gehört dazu.

2. `FallbackChatClient` stellt beide hintereinander. `choose_client()` liefert ihn,
   sobald **beide** Schlüssel gesetzt sind; ist nur einer gesetzt, wird dieser ohne
   Rückfallebene genommen, ist keiner gesetzt, bleibt Ollama für die Entwicklung.

3. **Der Wechsel greift nur vor dem ersten Token.** Groq prüft das
   Minutenkontingent, bevor es antwortet — der 429 kommt vor dem ersten Delta, der
   Wechsel bleibt für den Leser unsichtbar. Bricht der Strom dagegen *mitten* in
   der Antwort ab, wird nicht gewechselt: der halbe Satz steht bereits beim
   Client, ein zweiter Anlauf würde ihn doppelt schreiben.

4. **`name` und `model` melden, wer tatsächlich geantwortet hat.** Sie werden im
   Strom gesetzt; das `sources`-Ereignis liest sie erst danach aus. Die
   Oberfläche zeigt damit weiterhin den echten Anbieter, nicht den gewünschten.

5. **Fehler im Strom werden zum SSE-Ereignis, nicht zum Abbruch.** Zum Zeitpunkt
   des Fehlers sind die Kopfzeilen längst raus — ein HTTP-Fehlercode ginge ins
   Leere. `api/chat.py` sendet stattdessen `{"type": "error", …}`, danach die
   Belege und regulär `[DONE]`.

6. **Der Deploy-Gate trennt die beiden Rollen.** `MISTRAL_API_KEY` bleibt Pflicht
   (Embeddings), zusätzlich wird geprüft, dass überhaupt ein Chat-Anbieter
   konfiguriert ist.

## Verworfen

- **Nur Groq.** Ohne Embedding-Endpunkt nicht möglich, ohne den gesamten Bestand
  auf einen dritten Anbieter oder lokales Ollama umzubetten.
- **Nur Mistral.** Funktioniert und ist mit `mistral-small-latest` billig, kostet
  aber weiter Guthaben. Bleibt als Rückfallebene erhalten.
- **Ollama auf dem VPS.** Dauerhaft kostenlos, aber auf vier CPU-Kernen zu
  langsam: `qwen2.5` (7B) belegt rund 4,7 GB und liefert einstellige Token je
  Sekunde — eine Antwort bräuchte über eine Minute. Widerspricht außerdem der
  Rollenteilung aus ADR-0014 (der VPS bleibt ein dünner Leseserver).
- **Stiller Neuversuch nach abgebrochenem Strom.** Der Leser sähe den Anfang
  zweimal. Ein ehrlicher Hinweis ist besser als eine doppelte Antwort.

## Konsequenzen

- Der Normalbetrieb kostet nichts. Das Mistral-Guthaben wird zum Sicherheitsnetz
  statt zum Hauptposten.
- **`RATE_LIMIT` muss unter Groqs Takt liegen**, sonst produziert die eigene Seite
  die 429er, gegen die der Rückfall gebaut ist. Für den öffentlichen Betrieb
  `3/minute`.
- Die Antwortqualität schwankt jetzt zwischen zwei Modellen. Für einen Korpus,
  in dem das Retrieval die eigentliche Arbeit leistet, ist das vertretbar; das
  `sources`-Ereignis macht den Wechsel nachvollziehbar.
- Groqs freier Tarif hat keinen Auftragsverarbeitungsvertrag und liegt nicht in
  der EU. Für einen **vollständig öffentlichen** Forschungskorpus (ADR-0015) ist
  das unkritisch — die Formulierung „EU-API, AVV" gilt aber nur noch für den
  Embedding-Weg und wurde in `.env.example` entsprechend enger gefasst.
- Tests dürfen `GROQ_API_KEY` nicht aus der `.env` erben. Wie beim
  `EMBED_PROVIDER` (ADR-0014) setzen die Router- und Gate-Tests beide Schlüssel
  ausdrücklich.
- **Jeder Wechsel wird als WARNING protokolliert.** Ein stiller Rückfall ist von
  einem gesunden Dienst nicht zu unterscheiden: Beim ersten Deploy stand ein
  Modellname in der `.env`, den das Konto nicht freigeschaltet hatte. Groq
  antwortete auf *jede* Anfrage mit 404, der Rückfall fing alles ab, die Demo
  sah einwandfrei aus — und verbrauchte dabei Mistral-Guthaben statt des
  kostenlosen Kontingents. Sichtbar wurde es erst am `provider`-Feld im
  `sources`-Ereignis.
