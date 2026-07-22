"""Declarative base + metadata target for Alembic autogenerate."""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """All ORM models inherit from this. Alembic reads Base.metadata."""
