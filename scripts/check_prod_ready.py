"""Deploy-Gate (PLAN Phase 10): Startbereitschaft des öffentlichen Servers prüfen.

Läuft im Backend-Container gegen die Prod-Datenbank und -Umgebung:

    docker compose exec -T backend python scripts/check_prod_ready.py

Exit 0 = deploybar, Exit 1 = mindestens ein Check rot. Geprüft wird:

* **Bestand** — Korpus vorhanden und die Embeddings passen zum konfigurierten
  Modell. Ein Mismatch liefert sonst still die falschen Treffer (ADR-0014).
* **Umgebung** — `APP_ENV=production`, ausreichend starker Admin-Key,
  `MISTRAL_API_KEY` gesetzt (die Embeddings hängen daran), ein konfigurierter
  Chat-Anbieter, CORS ohne localhost, abgeschaltete Schreibrouten und ein
  Embedding-Anbieter, der ohne lokales Modell auskommt.
"""

from __future__ import annotations

import sys

MIN_ADMIN_KEY_LENGTH = 24


def run_checks(settings=None, session=None) -> list[tuple[str, bool, str]]:  # type: ignore[no-untyped-def]
    """Alle Gate-Checks als ``(Name, ok, Detail)``. Beides injizierbar für Tests."""
    from sqlalchemy import func, select

    from app.core.config import get_settings
    from app.db.models import Chunk, Document
    from app.db.session import SessionLocal
    from app.ingestion.embedding import (
        IndexModelMismatch,
        assert_index_matches_settings,
        index_embed_models,
    )

    settings = settings or get_settings()
    own_session = session is None
    if own_session:
        session = SessionLocal()

    checks: list[tuple[str, bool, str]] = []
    try:
        n_docs = session.execute(select(func.count()).select_from(Document)).scalar_one()
        n_chunks = session.execute(select(func.count()).select_from(Chunk)).scalar_one()
        checks.append(
            (
                "DB: Korpus ist befüllt",
                n_docs > 0 and n_chunks > 0,
                f"{n_docs} Dokumente / {n_chunks} Chunks",
            )
        )

        # Dieselbe Prüfung wie beim Start der App, statt sie hier nachzubauen —
        # sonst laufen zwei Fassungen derselben Regel auseinander.
        index_models = index_embed_models(session)
        try:
            assert_index_matches_settings(session)
            consistent, detail = True, f"Index={index_models or 'leer'}"
        except IndexModelMismatch as exc:
            consistent, detail = False, str(exc)
        checks.append(
            (
                "DB: Embeddings passen zum konfigurierten Modell",
                # Ein leerer Index besteht die Konsistenzprüfung, taugt aber nicht
                # für Produktion — dafür ist der Bestands-Check oben zuständig.
                consistent and bool(index_models),
                detail,
            )
        )
    finally:
        if own_session:
            session.close()

    checks.append(
        (
            "Env: APP_ENV=production",
            settings.app_env == "production",
            f"APP_ENV={settings.app_env}",
        )
    )
    checks.append(
        (
            f"Env: ADMIN_API_KEY stark (≥{MIN_ADMIN_KEY_LENGTH} Zeichen, nicht Default)",
            settings.admin_api_key != "change-me"
            and len(settings.admin_api_key) >= MIN_ADMIN_KEY_LENGTH,
            f"Länge {len(settings.admin_api_key)}",
        )
    )
    # Der Mistral-Schlüssel bleibt Pflicht, auch wenn Groq antwortet: Groq hat
    # keinen Embedding-Endpunkt, und ohne Query-Embedding findet die Suche nichts.
    checks.append(
        (
            "Env: MISTRAL_API_KEY gesetzt (Embeddings via EU-API)",
            bool(settings.mistral_api_key),
            "gesetzt" if settings.mistral_api_key else "leer",
        )
    )
    chat_providers = [
        name
        for name, key in (("groq", settings.groq_api_key), ("mistral", settings.mistral_api_key))
        if key
    ]
    checks.append(
        (
            "Env: Chat-Anbieter konfiguriert (Groq und/oder Mistral)",
            bool(chat_providers),
            " + ".join(chat_providers) if chat_providers else "keiner — Ollama-Fallback",
        )
    )
    checks.append(
        (
            "Env: CORS ohne localhost",
            not any("localhost" in o or "127.0.0.1" in o for o in settings.cors_origins_list),
            settings.cors_origins,
        )
    )
    # Die Schreibrouten sind in Produktion zu. Die Oberflaeche bietet sie nicht an,
    # offen waeren sie nur Angriffsflaeche mit einem einzigen Schluessel davor (ADR-0024).
    checks.append(
        (
            "Env: Schreibrouten abgeschaltet (WRITES_ENABLED=false)",
            not settings.writes_enabled,
            f"WRITES_ENABLED={settings.writes_enabled}",
        )
    )
    # Ein kleiner VPS hat kein Ollama. Mit EMBED_PROVIDER=ollama scheitert dort
    # jede Suchanfrage — der Gate fängt das vor dem Deploy ab (ADR-0014).
    checks.append(
        (
            "Env: EMBED_PROVIDER kommt ohne lokales Modell aus",
            settings.embed_provider == "mistral",
            f"EMBED_PROVIDER={settings.embed_provider}",
        )
    )
    return checks


def main() -> int:
    checks = run_checks()
    print("Deploy-Gate: Startbereitschaft des öffentlichen Servers\n")
    failed = 0
    for name, ok, detail in checks:
        print(f"  {'✓' if ok else '✗'} {name} — {detail}")
        if not ok:
            failed += 1
    print()
    if failed:
        print(f"GATE ROT: {failed} Check(s) fehlgeschlagen — NICHT deployen.")
        return 1
    print("GATE GRÜN: deploybar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
