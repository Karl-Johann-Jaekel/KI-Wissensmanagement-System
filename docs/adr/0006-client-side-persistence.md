# ADR-0006: Client-seitige Persistenz (Chats, Skills, Projekte)

Datum: 2026-08-03 · Status: akzeptiert

## Kontext

Das Redesign führt „Aktuelle Chats", Skills (Prompt-Vorlagen) und Projekte
(Arbeitsbereiche) ein. Das Backend hat kein User-Modell, keine Sessions und
keine Konversations-Tabellen; das öffentliche Deployment läuft ohne Login.

## Entscheidung

Alle drei Datenarten leben **ausschließlich im localStorage des Browsers**
(`kwms.v1.*`, versionierter Namespace, Modul `frontend/src/lib/storage.ts`):

- `chats.index` (Metadaten) + `chat.<id>` (Messages inkl. Quellen) —
  getrennte Keys, damit ein Stream-Ende nur einen Key schreibt
- `skills`, `projects`, `adminKey` (Migration vom Legacy-Key `kwms-admin-key`),
  `theme`, `sidebar`
- Caps: 100 Chats / 200 Messages pro Chat (ältestes fliegt raus);
  `QuotaExceededError` wirft nie, sondern meldet `false` → Toast im UI
- React-Anbindung via `useSyncExternalStore`-Hooks

## Begründung

- **DSGVO:** Der Server speichert keine Konversationen — es entstehen
  serverseitig keine personenbeziehbaren Chat-Daten, kein Lösch-/Auskunfts-
  Aufwand, kein Auth-System nötig.
- Öffentlicher Betrieb ohne Login: DB-Persistenz würde entweder alle Besucher
  mischen oder ein User-Konzept erzwingen (großer Scope, verworfen).

## Konsequenzen

- Chats sind nicht geräteübergreifend und gehen beim Browserdaten-Löschen
  verloren — bewusster Trade-off, im UI nicht als Server-Speicher verkauft.
- localStorage-Limit (~5 MB) wird durch Caps + Pruning verwaltet.
- Ein späteres Server-Sync (z. B. für den lokalen Admin-Betrieb) kann über
  die `schemaVersion` im Namespace migriert werden.
