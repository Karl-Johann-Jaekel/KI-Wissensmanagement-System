# ADR-0005: Erweiterung der Frontend-Dependencies

Datum: 2026-08-03 · Status: akzeptiert

## Kontext

Das Frontend war bewusst minimal (3 Runtime-Deps: react, react-dom,
react-force-graph-2d): ein Tab-Switch ohne Router, dark-only, keine
Persistenz. Das UI/UX-Redesign (RelationFlow-artige Sidebar-App mit Seiten
Chat/Suche/Inbox/Wissen/Skills/Bibliothek/Projekte, Deep-Links, hell/dunkel,
mobile-friendly) ist mit diesem Setup nicht mehr sinnvoll umsetzbar.

## Entscheidung

Neue Runtime-Dependencies (bewusst klein gehalten):

| Paket | Zweck |
|---|---|
| `react-router-dom@^6` | Deep-Links (`/chat/:id`, `/wissen/doc/:id`, `/projekte/:id`), Browser-History statt Tab-State |
| `lucide-react` | Icon-Satz für Sidebar/Aktionen; tree-shakeable, nur genutzte Icons landen im Bundle |
| `clsx` + `tailwind-merge` | Bedingte Klassen + Konfliktauflösung für Varianten-Primitives (ersetzt String-Konkatenation) |
| `react-markdown` + `remark-gfm` | Dokument-Reader und gerenderte Chat-Antworten (Tabellen via GFM) |

Neue Dev-Dependencies: `vitest`, `jsdom`, `@testing-library/react` — Tests für
Storage-Layer, SSE-Parser und Chat-Reducer; CI bekommt einen Frontend-Job.

## Abgelehnt

- **CodeMirror/Monaco** für den MD-Editor: ein `<textarea>` reicht für den
  Anwendungsfall; ein Code-Editor wäre die mit Abstand größte Dependency.
- **State-Library** (Zustand/Redux): React-Context + `useSyncExternalStore`
  über dem localStorage-Layer decken den Bedarf.
- **Component-Library** (shadcn/ui, Radix, MUI): handgerollte Primitives auf
  Design-Tokens passen zur Minimal-Philosophie und zum eigenen Farbschema.

## Konsequenzen

- Bundle wächst moderat; alle Pakete sind tree-shakeable bzw. klein.
- `npm run build` (tsc strict + `noUnusedLocals`) bleibt das Struktur-Gate;
  vitest ergänzt Verhaltens-Tests für die neuen reinen Module.
