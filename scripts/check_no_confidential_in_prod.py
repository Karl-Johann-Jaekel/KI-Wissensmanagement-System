"""Deploy-Gate (PLAN Phase 10): der öffentliche Server darf NUR public-Daten enthalten.

Läuft im Backend-Container gegen die Prod-DB und -Env:

    docker compose exec -T backend python scripts/check_no_confidential_in_prod.py

Exit 0 = deploybar; Exit 1 = mindestens ein Check rot. Prüft:
- DB: keine Dokumente/Chunks außerhalb der public-Zone
- Env: APP_ENV=production, starker ADMIN_API_KEY, MISTRAL_API_KEY gesetzt,
  CORS nicht auf localhost, data/private/ leer oder abwesend
"""

from __future__ import annotations

import sys
from pathlib import Path

MIN_ADMIN_KEY_LENGTH = 24


def run_checks(settings=None, session=None) -> list[tuple[str, bool, str]]:  # type: ignore[no-untyped-def]
    """Alle Gate-Checks als (Name, ok, Detail). Injektion für Tests."""
    from sqlalchemy import func, select

    from app.core.config import get_settings
    from app.db.models import Chunk, Document
    from app.db.session import SessionLocal

    settings = settings or get_settings()
    own_session = session is None
    if own_session:
        session = SessionLocal()

    checks: list[tuple[str, bool, str]] = []
    try:
        non_public_docs = session.execute(
            select(func.count()).select_from(Document).where(Document.sensitivity != "public")
        ).scalar_one()
        checks.append(
            (
                "DB: keine non-public Dokumente",
                non_public_docs == 0,
                f"{non_public_docs} gefunden",
            )
        )

        non_public_chunks = session.execute(
            select(func.count())
            .select_from(Chunk)
            .join(Document, Chunk.document_id == Document.id)
            .where(Document.sensitivity != "public")
        ).scalar_one()
        checks.append(
            (
                "DB: keine non-public Chunks",
                non_public_chunks == 0,
                f"{non_public_chunks} gefunden",
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
    checks.append(
        (
            "Env: MISTRAL_API_KEY gesetzt (public-Zone via EU-API)",
            bool(settings.mistral_api_key),
            "leer" if not settings.mistral_api_key else "gesetzt",
        )
    )
    checks.append(
        (
            "Env: CORS ohne localhost",
            not any("localhost" in o or "127.0.0.1" in o for o in settings.cors_origins_list),
            settings.cors_origins,
        )
    )

    private_dir = Path("data/private")
    private_files = (
        [p for p in private_dir.rglob("*") if p.is_file()] if private_dir.exists() else []
    )
    checks.append(
        (
            "FS: data/private/ leer oder abwesend",
            len(private_files) == 0,
            f"{len(private_files)} Datei(en)",
        )
    )
    return checks


def main() -> int:
    checks = run_checks()
    print("Deploy-Gate: öffentlicher Server darf nur public-Daten enthalten\n")
    failed = 0
    for name, ok, detail in checks:
        mark = "✓" if ok else "✗"
        print(f"  {mark} {name} — {detail}")
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
