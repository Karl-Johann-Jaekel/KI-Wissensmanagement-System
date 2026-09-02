# ADR-0010: Durchsatz der Fakten-Freigabe erhöhen

Datum: 2026-08-03 · Status: teilweise überholt — die konfigurierbaren Schwellen gelten, die Oberfläche entfiel mit ADR-0023, gezählt wird seit ADR-0022 in `entities_extracted`

## Kontext

Nach dem ersten Living-Knowledge-Lauf standen 95 Graph-Knoten in der DB, davon
nur 19 `verified` — 76 warteten in der Review-Queue. Ursache ist nicht die
Extraktion, sondern die Promotion-Regel: Auto-Übernahme verlangt **zwei
unabhängige Quell-Dokumente** (PLAN §2.7). Bei einem Korpus von 16 Papers
tritt ein Konzept selten in zwei davon auf, also bleibt fast alles pending.
Die Freigabe erfolgte bis dahin knotenweise per Einzelklick und Einzel-Request.

## Entscheidung

Drei Maßnahmen — **die Provenienzpflicht bleibt in allen Fällen unangetastet**:

1. **Sammelfreigabe** `POST /review/bulk` (`{ids, action}`, admin-only, max. 500
   IDs). Die Kantenprüfung läuft einmal für den ganzen Stapel statt je Knoten,
   damit eine Freigabe von 76 Fakten nicht 76 Requests und 76 Volltabellen-
   Durchläufe kostet. Der Einzel-Endpoint nutzt dieselbe Funktion.
2. **Review-UI mit Mehrfachauswahl**: Filter nach Quellenzahl und Konfidenz,
   „alle sichtbaren auswählen", plus eine Schnellaktion „N gut belegte
   freigeben" (alles mit ≥ 2 Quellen).
3. **Konfigurierbare Schwellen** `PROMOTE_MIN_SOURCES` / `PROMOTE_CONFIDENCE`
   (Default unverändert 2 bzw. 0.7), zusätzlich als CLI-Flags
   `--min-sources` / `--confidence` an `app.update`.

## Begründung

Der schnellste Weg zu mehr verifiziertem Wissen ist ein **größerer Korpus** —
dann greift die 2-Quellen-Regel von selbst. Bis dahin ist menschliche Freigabe
der richtige Hebel: Sie beschleunigt den Durchsatz, ohne die Belegkette zu
schwächen. Deshalb wurde die Regel **nicht** grundsätzlich gelockert, sondern
nur bedienbarer und für den Betreiber einstellbar gemacht.

## Konsequenzen / Risiko

- `PROMOTE_MIN_SOURCES=1` macht den Graphen schnell voll, aber jeder Fakt hängt
  dann an einer einzigen LLM-Extraktion. Das ist genau das Risiko, das
  PLAN §11 („Extraktions-Halluzinationen") adressiert — nur bei kleinem,
  überschaubarem Korpus und mit Nachkontrolle sinnvoll.
- Sammelablehnung ist ebenso schnell wie Sammelfreigabe; `rejected` bleibt
  erhalten (kein Löschen), der Fakt kann später erneut auftauchen.
