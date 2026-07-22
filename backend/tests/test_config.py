"""Settings behaviour: DB URL derivation + override."""

from __future__ import annotations

from app.core.config import Settings


def test_sqlalchemy_url_derived_from_parts() -> None:
    s = Settings(
        postgres_user="u",
        postgres_password="p",
        postgres_host="h",
        postgres_port=5433,
        postgres_db="d",
        database_url=None,
    )
    assert s.sqlalchemy_url == "postgresql+psycopg://u:p@h:5433/d"


def test_explicit_database_url_wins() -> None:
    s = Settings(database_url="postgresql+psycopg://x/y")
    assert s.sqlalchemy_url == "postgresql+psycopg://x/y"
