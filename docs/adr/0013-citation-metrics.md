# ADR-0013: Zitationsmetriken als Qualitätssignal

Datum: 2026-08-04 · Status: akzeptiert

## Kontext

Der Graph behandelte alle Papers gleich — ein Grundlagenpaper mit sechsstelliger
Zitationszahl sah aus wie ein Preprint von letzter Woche. Für eine Übersicht
über den Forschungsstand ist genau dieser Unterschied die wichtigste Information.

## Entscheidung

**Quelle: Semantic Scholar Graph API.** Die arXiv-API liefert keine
Zitationszahlen. Semantic Scholar ist frei nutzbar, adressiert Papers direkt über
die arXiv-ID und liefert neben `citationCount` auch `influentialCitationCount`.
Der Batch-Endpoint nimmt bis zu 500 IDs, der gesamte Korpus kostet also einen
Aufruf. Ein API-Key (`SEMANTIC_SCHOLAR_API_KEY`) hebt das Kontingent, ist aber
optional.

**Zonenschutz:** Abgefragt werden ausschließlich Dokumente mit
`sensitivity = public` und `source_type = arxiv_pdf`. Übertragen wird nur eine
bereits veröffentlichte arXiv-ID, nie Inhalt. Vertrauliche Dokumente erreichen
den Dienst nicht — durch einen Test abgesichert.

**Ablage:** `documents.meta.citations` (`{citations, influential, year, venue,
source, fetched_at}`), gespiegelt auf den Paper-Knoten, damit `/graph` die Zahl
ohne Join ausliefert. `GET /graph` ergänzt je Knoten `citations` und `landmark`.

**Darstellung: goldener Ring, nicht Knotengröße.** Die Größe kodiert bereits den
Vernetzungsgrad; würde sie zusätzlich Zitationen tragen, wären beide Signale
nicht mehr trennbar. Der Ring liegt außerhalb der Typ-Palette (Blau/Amber/Rot/
Violett) und bleibt in beiden Themes lesbar. Schwelle:
`CITATION_LANDMARK_MIN` (Standard 100).

## Konsequenzen

- Ausfall des Dienstes ist unkritisch: Der Bestand bleibt unverändert, die
  Anzeige fällt auf „keine Angabe" zurück, der Abruf ist idempotent wiederholbar.
- Zitationszahlen altern. Ein regelmäßiger Refresh gehört in den Update-Loop
  bzw. den wöchentlichen Cron.
- Frische Preprints stehen naturgemäß bei 0 — der Ring zeichnet Etabliertes aus,
  er wertet Neues nicht ab. Beim aktuellen Bestand: 16 von 56 Papers über der
  Schwelle.
- Ein weiterer externer Dienst (US-Anbieter) im public-Pfad. Vertretbar, weil
  nur öffentliche Kennungen übertragen werden; im Deploy-Gate nicht relevant.
