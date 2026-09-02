"""SQLAlchemy engine + session factory (sync)."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_settings = get_settings()

# Die Handler sind synchron und laufen in Starlettes Threadpool (40 Threads). Der
# Chat haelt seine Session ueber den gesamten SSE-Strom — mit dem Vorgabepool
# (5 + 10 Ueberlauf) blockiert ab dem 16. gleichzeitigen Chat der Checkout, und
# zwar unsichtbar: die Anfrage haengt, bis eine andere fertig ist.
engine = create_engine(
    _settings.sqlalchemy_url,
    pool_pre_ping=True,
    future=True,
    pool_size=_settings.db_pool_size,
    max_overflow=_settings.db_max_overflow,
    # Lieber ein klarer Fehler als eine Anfrage, die minutenlang haengt.
    pool_timeout=_settings.db_pool_timeout_s,
    # Verbindungen, die laenger als eine halbe Stunde standen, neu aufbauen —
    # Postgres und Proxys schliessen sie sonst unbemerkt.
    pool_recycle=1800,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: yields a session, always closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
