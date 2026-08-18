# ADR-0018: Quellen-Harvester — OAI-PMH, Dedupe, invertierte Abstracts

Datum: 2026-08-18 · Status: akzeptiert · Ergänzt ADR-0017

## Kontext

Der Korpus wuchs bisher über `app.corpus.arxiv`: die arXiv-**Query-API** mit
`sortBy=submittedDate`. Das reicht für einen Seed, nicht für laufende Aktualität.
Die Query-API kennt kein Änderungsdatum — ein Delta-Lauf liefert entweder
Dubletten (Fenster überlappt) oder Lücken (Fenster zu eng), und überarbeitete
Fassungen bereits bekannter Papers sieht er nie.

Zweitens soll der Bestand mehr als eine Quelle tragen. OpenReview ist unter den
verfügbaren Quellen die einzige mit offenen **Gutachten und Erwiderungen** — das
ist Material, das sonst nirgends strukturiert vorliegt.

## Entscheidung

**OAI-PMH statt Query-API für die Delta-Ernte.** `from`/`until` filtern auf das
Änderungsdatum; geblättert wird über `resumptionToken`. Der bisherige
`app.corpus.arxiv` bleibt unangetastet — er bedient den Update-Loop aus Phase 8,
und ein Umbau gehört in denselben Schritt wie dessen Anbindung, nicht hierher.

Zwei Dinge wurden am 18.08.2026 gegen die echten Dienste geprüft, nicht angenommen:

* Der Endpunkt ist **`https://oaipmh.arxiv.org/oai`**. Der historische
  `export.arxiv.org/oai2` antwortet nicht mehr.
* Metadatenformat **`arXiv`**, nicht `oai_dc`: Es trennt Vor- und Nachnamen,
  führt Kategorien einzeln und nennt DOI und Lizenz. `oai_dc` presst alles in
  Dublin-Core-Felder und verliert die Struktur.

OAI erlaubt genau ein Set je Anfrage, die vier Fachgebiete des Korpus
(`cs.AI/CL/IR/LG`) werden deshalb nacheinander geerntet — mit einem
quellenübergreifenden Dedupe-Index, weil ein Paper in mehreren Sets liegt.

**Abstracts nur als invertierter Index.** `HarvestRecord` hat kein Feld für
Abstract-Rohtext; es gibt nur `abstract_index` (`{Token: [Positionen]}`). Was der
Datentyp nicht kennt, kann später niemand versehentlich speichern. Das ist
**keine Anonymisierung** — der Wortlaut ließe sich rekonstruieren. Es ist die
Form, in der OpenAlex Abstracts verteilt, und sie trägt Suche und Termstatistik.
Volltexte kommen weiterhin ausschließlich aus CC-lizenzierten Quellen über die
bestehende Ingest-Pipeline.

**Keine Kontaktdaten.** Autorenfelder laufen durch `strip_emails`. Bei OpenReview
wird `authorids` **gar nicht** übernommen: Das Feld enthält bei nicht
registrierten Autor:innen wörtlich E-Mail-Adressen.

**Dedupe über DOI und Titelschlüssel.** Beide Wege sind nötig — Preprints tragen
oft keine DOI, und dieselbe Arbeit erscheint auf arXiv und OpenReview unter
identischem Titel. Der Index ist quellenübergreifend und wird zu Laufbeginn aus
den bisherigen Ernten aufgebaut.

**Wiederaufnahme ist der Normalfall.** Zeitmarke und Blätter-Zeiger stehen in
`data/harvest/state.json`, atomar geschrieben. Solange ein Zeiger offen ist,
rückt die Zeitmarke **nicht** vor — sonst überspränge der nächste Lauf genau die
Seiten, die dieser nicht mehr geschafft hat. Ein abgelaufener Zeiger
(`badResumptionToken`) ist kein Fehlerfall, sondern setzt den Lauf auf den
Zeitfilter zurück; `noRecordsMatch` ist die leere Antwort, kein Fehler.

**`Retry-After` schlägt die eigene Wartekurve.** arXiv beantwortet zu dichte
Abfragen mit `503` **und** diesem Header; wer ihn ignoriert, wird gesperrt statt
gedrosselt. 4xx wird nicht wiederholt — ein Programmierfehler wird durch
Wiederholen nicht besser.

**OpenReview verlangt ein Konto.** Anonyme Anfragen an `api2.openreview.net`
beantwortet der Dienst seit 2026 mit `403 ChallengeRequiredError`, einer
Browser-Challenge. Der Harvester **umgeht sie nicht**. Er erkennt die Antwort,
bricht sofort ab (Wiederholen hilft dagegen nicht) und nennt den Weg:
`OPENREVIEW_USERNAME`/`OPENREVIEW_PASSWORD` setzen, ein Konto ist kostenlos.

## Konsequenzen

- Der arXiv-Pfad ist live erprobt: 25 Datensätze aus einem Zwei-Tage-Fenster in
  6 s, ein zweiter Lauf erkannte alle 25 als Dubletten. Der erste geerntete
  Datensatz war ein Paper von 2021 mit Änderungsdatum 2026-08-05 — genau der
  Fall, den die Query-API nie geliefert hätte.
- Der **OpenReview-Pfad ist nicht live verifiziert**: ohne Konto kein Zugang.
  Parser, Blättern, Zeitfilter und die Challenge-Erkennung sind gegen
  `MockTransport` geprüft, der Login-Fluss nicht.
- Geerntet wird nach JSON Lines, nicht in die Datenbank. Die Senke ist ein
  `Callable`; Phase 11.5 hängt dort das Provenienz-Schema an, ohne dass ein
  Harvester davon weiß.
- `--cap N` begrenzt **neue** Datensätze je Lauf, nicht gelesene. Ein Lauf
  arbeitet sich also durch bekannte Datensätze hindurch, bis N neue zusammen sind.
