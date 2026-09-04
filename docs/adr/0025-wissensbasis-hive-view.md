# ADR-0025: Wabenansicht als Einstieg in die Wissensbasis

Datum: 2026-09-04 · Status: akzeptiert · Ergänzt ADR-0016 · Setzt ADR-0017 voraus

## Kontext

Der Graph-Explorer (ADR-0016) beantwortet gut, *was woran hängt*: man greift einen
Knoten, folgt seinen Kanten und liest im Panel nach. Er beantwortet nicht, *was
überhaupt da ist*. Seit dem Papers-with-Code-Import (ADR-0017) trifft der Einstieg
auf zweitausend Knoten in einer Kraftsimulation — ohne Vorwissen ist daraus weder
die Zusammensetzung des Bestands abzulesen noch, welche Quelle wie viel beisteuert
oder wo überhaupt Dokumente hinterlegt sind.

Zweitens verdeckt die Simulation ihre eigene Unschärfe. `/graph` kappt auf 2.000
Knoten mit einem Kontingent je Art; wer die Wolke ansieht, hält sie für den Bestand.

## Entscheidung

`/wissen` bekommt einen dritten Reiter **Wissensbasis**, und er ist der neue
Standard; der Graph rückt auf `?tab=graph`. Die Ansicht zeigt sieben Waben um einen
Kern: sechs Knotenarten (`paper`, `concept`, `model`, `dataset`, `task`, `repo`) und
die Systemebene aus `SERVICES`. Jede Wabe trägt ihre Größe und eine Konstellation
ihrer bestvernetzten Knoten; ein Klick öffnet ein Popup mit sechs Reitern
(Übersicht, Knoten, Verbindungen, Dokumente, Cluster, Zeitleiste).

Drei Festlegungen tragen das:

1. **Aggregation getrennt von Darstellung.** `components/wissen/hive/hive.ts` ist
   rein — keine React-, Canvas- oder Fetch-Abhängigkeit. Sektoren, Kennzahlen,
   Zeitleiste, Quellen, Begriffe und die Wabengeometrie sind damit einzeln testbar.
2. **Kein zweiter Wahrheitsbegriff.** Cluster kommen aus `clusterAssignment` in
   `graph/scene.ts`, Kantenbezeichnungen aus `graph/relations.ts` — dieselbe Kante
   heißt in beiden Ansichten gleich, dasselbe Thema ist gleich geschnitten.
   `relationLabel` und `clusterLabel` wurden dafür aus ihren Modulen herausgereicht.
3. **Die Kappung wird benannt.** Die Fußzeile sagt, dass die Antwort auf 2.000
   Knoten gekappt ist. `val` (Server, ganzer Graph, vor der Kappung) und `degree`
   (Kanten in dieser Antwort) stehen als zwei Zahlen nebeneinander, statt eine für
   die andere auszugeben.

## Konsequenzen

- Die Zeitleiste liest das Jahr aus Datumsfeld, arXiv-Id oder Quell-URL — **nicht**
  aus `first_seen`, das nur den Eintritt in diesen Bestand festhält. Knoten ohne
  Datum werden getrennt gezählt und ausgewiesen; im Papers-with-Code-Bestand
  betrifft das jede Art außer `paper` vollständig. Das ist die ehrliche Auskunft,
  sieht aber leer aus.
- „Hauptgruppen" bleibt für Konzepte und Aufgaben leer: Beide *sind* die Anker der
  Themenzuordnung, jeder Knoten wäre seine eigene Gruppe. Die Ansicht schweigt dort
  mit Begründung, statt einen Ring aus Einer-Gruppen zu zeichnen.
- „Nur vielzitierte" filtert auf das Landmark-Kennzeichen (ADR-0013) und liefert im
  aktuellen Bestand eine Handvoll Knoten — die Zitationsdaten sind dünn besetzt.
- Der Wechsel des Standard-Reiters trifft jeden Verweis auf `/wissen`
  (Sidebar, Inbox, Dokument-Zurück). Verweise auf den Graphen führen weiterhin
  ausdrücklich `?tab=graph`.
- Die Ansicht lädt faul (`HiveView` als eigener Chunk, ~15 kB gzip) und stellt keine
  eigenen Anfragen an das Backend: sie nutzt `GET /graph` und die bereits geladene
  Dokumentliste. Es kommt kein Endpunkt hinzu.
