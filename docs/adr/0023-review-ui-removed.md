# ADR-0023: Review-Oberfläche entfernt — die Regel trägt allein

Status: akzeptiert
Datum: 2026-09-01

## Kontext

Phase 8 sah zwei Wege vor, wie ein `pending`-Fakt zu `verified` wird: die
regelbasierte Promotion und ein Mensch, der im Frontend verify/reject klickt. Der
zweite Weg wurde mit `16cacfa` entfernt — `ReviewList.tsx`, `AdminKeyContext.tsx` und
`AdminKeyModal.tsx` sind gelöscht, die Inbox ist eine Erklärseite.

PLAN.md und CLAUDE.md beschrieben die Oberfläche weiterhin als vorhanden. Auch die
Landing-Page, der Markdown-Editor, das Upload-Panel und das helle Thema standen dort
noch, obwohl sie in `16cacfa`/`c7e1564` verschwunden sind.

## Entscheidung

Die Oberfläche wird **nicht** wieder aufgebaut. Die Endpunkte bleiben: `GET /review`,
`POST /review/node/{id}` und `POST /review/bulk` sind weiterhin da und admin-gated,
erreichbar per HTTP-Client oder MCP. Was fehlt, ist die Bedienoberfläche, nicht die
Fähigkeit.

Damit entscheidet in der Praxis die Regel allein, was verifiziertes Wissen wird. Das
verschiebt Gewicht auf ihre Qualität, und genau daran hing der schwerste Fehler des
Systems: sie zählte Quellen in einem JSONB-Feld, das der Upsert überschrieb
(ADR-0022). Solange kein Mensch gegenliest, muss diese Rechnung stimmen — die
Umstellung auf `entities_extracted` ist deshalb Voraussetzung dieser Entscheidung,
nicht Beiwerk.

## Konsequenzen

- `pending`-Fakten sind nur noch mit Admin-Schlüssel über die API einsehbar. Wer sie
  regelmäßig durchsehen will, braucht dafür ein Werkzeug — heute gibt es keines.
- `PROMOTE_MIN_SOURCES` und `PROMOTE_CONFIDENCE` bestimmen faktisch allein, was in den
  öffentlichen Graphen gelangt. Steht `PROMOTE_MIN_SOURCES` auf 1, ist die
  „2-Quellen-Regel" außer Kraft; das ist eine bewusste Betriebsentscheidung und sollte
  eine bleiben.
- Verworfene Knoten (`rejected`) bleiben dauerhaft verworfen, weil niemand sie
  zurückholt. Neue Kanten werden nicht mehr an sie gehängt.
- Kommt die Oberfläche zurück, ist dieser ADR abzulösen; die Endpunkte sind noch da.
