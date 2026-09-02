"""Logging-Konfiguration — eine Stelle für API und Batch-Läufe.

``LOG_LEVEL`` war bis hierher tote Konfiguration: deklariert, dokumentiert und
nirgends gelesen. Ohne Konfiguration verschluckt der Root-Logger alles unterhalb
von WARNING, und auf einem öffentlichen Server heißt das: die Fehler, die man
sehen müsste, tauchen nirgends auf.

Bewusst Klartext statt JSON: es gibt keinen Log-Aggregator: gelesen wird das über
``docker compose logs``, und dort ist eine Zeile je Ereignis brauchbarer als ein
Objekt je Ereignis. Kommt später ein Aggregator dazu, ist hier die eine Stelle,
an der das umgestellt wird.
"""

from __future__ import annotations

import logging.config

#: Nur der eigene Namensraum wird konfiguriert. uvicorns Logger (Zugriff, Fehler)
#: bringt der Server selbst mit; sie zu überschreiben nähme ihm seine Formatierung.
APP_LOGGER = "app"

_FORMAT = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"


def configure_logging(level: str | None = None) -> None:
    """Den ``app``-Namensraum auf ``LOG_LEVEL`` setzen. Mehrfachaufruf ist harmlos."""
    from app.core.config import get_settings

    resolved = (level or get_settings().log_level).upper()
    logging.config.dictConfig(
        {
            "version": 1,
            # uvicorns bereits eingerichtete Logger nicht stilllegen.
            "disable_existing_loggers": False,
            "formatters": {"default": {"format": _FORMAT}},
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "formatter": "default",
                    "stream": "ext://sys.stdout",
                }
            },
            "loggers": {
                APP_LOGGER: {"handlers": ["console"], "level": resolved, "propagate": False}
            },
        }
    )
