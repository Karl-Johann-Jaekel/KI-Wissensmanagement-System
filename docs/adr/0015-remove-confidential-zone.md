# ADR-0015: Zwei-Zonen-Architektur entfernt

Datum: 2026-08-10 · Status: akzeptiert · Ersetzt Teile von ADR-0008, ADR-0014

## Kontext

Das System trug von Beginn an zwei Datenzonen: `public` (Korpus, EU-API erlaubt)
und `confidential` (nur lokales Ollama-Modell). Nach dem Wechsel der Embeddings
auf `mistral-embed` (ADR-0014) zeigte sich die harte Konsequenz: Embeddings sehen
den vollen Chunk-Text, ein entfernter Anbieter ist für vertrauliche Inhalte damit
ausgeschlossen — und **ein Bestand kann nur ein Embedding-Modell tragen**. Eine
private Bibliothek hätte also ohnehin eine eigene Datenbank gebraucht.

Der Betreiber setzt die Idee deshalb als eigenständiges Projekt um. Was hier
bleibt, ist ein vollständig öffentlicher Forschungskorpus.

## Entscheidung

Die Zone wird **vollständig entfernt**, nicht auf `public` festgenagelt — ein
halb implementiertes Konzept im Code ist schlechter als keines.

* **Schema:** `documents.sensitivity` entfällt (Migration `0003`, mit downgrade).
* **Retrieval:** keine Zonenfilter mehr in Vektor- und Volltextarm.
* **Router:** `choose_client()` kennt nur noch eine Regel — Mistral, sofern ein
  Schlüssel konfiguriert ist, sonst lokales Ollama als Entwicklungs-Fallback.
  `zone_of()` und `require_admin_for_nonpublic()` entfallen.
* **Ollama-Pfad:** `GET /models` und das Modell-Override pro Anfrage (ADR-0008)
  entfallen mit — beide existierten nur, um die lokale Zone bedienbar zu machen.
* **Frontend:** Bibliothek-Seite, Zonen-Chip, Modell-Menü und
  Sensitivity-Badges entfernt.
* **Deploy-Gate:** aus `check_no_confidential_in_prod.py` wird
  `check_prod_ready.py`. Die Frage lautet nicht mehr „sind vertrauliche Daten
  drin", sondern „kann dieser Server ausliefern": Korpus vorhanden, Embeddings
  passend zum konfigurierten Modell, Umgebung sauber.

## Konsequenzen

- Die Oberfläche verliert einen Bereich, gewinnt aber Klarheit: Jede sichtbare
  Funktion hat eine Entsprechung im Backend.
- Der Admin-Key bleibt — er schützt weiterhin Upload, Löschen, Review und die
  unbestätigten Fakten im Graphen.
- Der Zonen-Router war das architektonisch interessanteste Stück des Systems.
  Diese Geschichte gehört jetzt zum Nachfolgeprojekt, nicht mehr hierher; das
  README wurde entsprechend ehrlich gehalten.
- Migration `0003` ist umkehrbar, die ursprüngliche Einstufung der Dokumente
  aber nicht — beim downgrade landen alle Zeilen in `public`.
