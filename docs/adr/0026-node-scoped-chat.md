# ADR-0026: Chat am Knoten bindet das Thema serverseitig

Datum: 2026-09-04 · Status: akzeptiert · Ergänzt ADR-0025 · Setzt ADR-0003 voraus

## Kontext

Am Datenpunkt steht seit Phase 8 ein Eingabefeld: eine Frage, eine belegte
Antwort. Es schickte bisher `POST /chat` mit `"<Knotenname>: <Frage>"`. Der Name
war damit ein Hinweis an das Retrieval, keine Schranke — wer wollte, hatte hier
ein öffentliches Feld an einem Sprachmodell und konnte danach fragen, wonach er
wollte. Mit der Wabenansicht (ADR-0025) steht dasselbe Feld an jedem Knoten des
Einstiegs, also an prominenter Stelle.

Ein Prompt allein hilft dagegen nicht: Er ist eine Bitte an das Modell, keine
Grenze, und er steht im selben Kanal wie die Eingabe des Besuchers.

## Entscheidung

Neuer Endpunkt `POST /chat/node` mit `{node_id, question}`. Der Themenrahmen
kommt aus der Datenbank, nicht aus der Anfrage. Die Schranken liegen in dieser
Reihenfolge:

1. **Gegenstand serverseitig.** `load_node` liest Name und Art aus `graph_nodes`.
   Eine unbekannte oder nicht `verified` Id endet als 404. Einen eigenen
   Themennamen kann der Aufrufer nicht mitschicken — das Feld gibt es nicht.
2. **Wissen nur aus dem Korpus.** Kontext sind ausschließlich Chunks der eigenen
   Datenbank; der Prompt verbietet alles darüber hinaus (wie in `prompts.py`).
   Das Modell hat keine Werkzeuge, keinen Datenbankzugriff, kein SQL.
3. **Ohne Fund kein Modellaufruf.** Liefert die Suche nichts, antwortet der Server
   mit einem festen Satz im selben SSE-Format. Kein Prompt, keine Token.
4. **Frage als Inhalt.** `sanitize_question` normalisiert Unicode, entfernt
   Steuer-, Nullbreiten- und Bidi-Zeichen, faltet Zeilenumbrüche zu Leerzeichen
   und streicht `<frage>`-Marken. Der Prompt deklariert den Text zwischen den
   Marken ausdrücklich als Eingabe, die niemals Anweisung ist.
5. **Menge begrenzt.** 300 Zeichen statt 2.000, `top_k ≤ 10`; Rate-Limit und
   Tagesbudget je Client gelten unverändert (ADR-0003).

Die Kurzerklärung im selben Fenster kommt **ohne** Modellaufruf aus: Art des
Knotens, Jahr, Belege, Zitationen und Verbindungen stehen bereits in den Daten
(`components/graph/nodeFacts.ts`).

## Konsequenzen

- Prompt-Injection wird dadurch nicht unmöglich. Begrenzt wird, was ein Treffer
  wert wäre: Es gibt keine Werkzeuge zu übernehmen, keine fremden Daten zu
  erreichen und kein Wissen außer den mitgelieferten Absätzen. Das teuerste
  denkbare Ergebnis ist eine themenfremde Antwort aus dem eigenen Korpus.
- Der Wortlaut der Absage steht zweimal — einmal als Konstante im Code, einmal im
  System-Prompt. Das ist Absicht: Absage aus dem Code und Absage aus dem Modell
  sollen für den Besucher gleich klingen. Wer den Text ändert, ändert beide über
  dieselbe Konstante.
- Erfundene Knoten (Kern, Dienste, Projekte aus `scene.ts`) haben keine Id in
  `graph_nodes`. Der Chat wird für sie im Frontend gar nicht erst gezeigt
  (`isGraphNodeId`), sonst liefe jede Frage in ein 404.
- `/chat` bleibt offen wie bisher — die Chat-Seite ist ein allgemeiner Einstieg
  in den Korpus und soll das bleiben. Gebunden ist nur der Chat am Knoten.
- Der SSE-Rumpf ist jetzt `stream_plan` und wird von beiden Endpunkten benutzt;
  Fehlerbehandlung und Budgetabrechnung gibt es damit einmal statt zweimal.
