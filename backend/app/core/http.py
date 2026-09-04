"""Caching-Kopfzeilen für die öffentlichen Lese-Endpunkte.

Der Bestand wächst im Wochentakt (Update-Loop), nicht im Sekundentakt. Fünf
Minuten Caching nehmen den Wiederholungsverkehr weg, den eine Einzelseiten-App
sonst bei jedem Reiterwechsel erzeugt — ohne dass eine Änderung sichtbar spät
ankommt.

Das ist kein Schönheitsthema: Ohne diese Kopfzeile holt der Browser dieselbe
Liste bei jedem Mount neu, und jede dieser Anfragen zählt gegen das Rate-Limit.
Genau daran scheiterte der Reiter „Dokumente" mit ``HTTP 429``, während ``/graph``
— das die Kopfzeile hatte — unauffällig blieb.
"""

from __future__ import annotations

from fastapi import Response

#: Wie lange eine öffentliche Leseantwort wiederverwendet werden darf.
PUBLIC_CACHE_SECONDS = 300


def public_cache(response: Response, seconds: int = PUBLIC_CACHE_SECONDS) -> None:
    """Antwort als öffentlich zwischenspeicherbar kennzeichnen."""
    response.headers["Cache-Control"] = f"public, max-age={seconds}"


def no_store(response: Response) -> None:
    """Antwort vom Zwischenspeichern ausnehmen.

    Für alles, was je nach Aufrufer verschieden ausfällt oder sich jederzeit
    ändern kann — ungeprüfte Fakten, und Inhalte auf einer Instanz, deren
    Schreibwege offen sind.
    """
    response.headers["Cache-Control"] = "private, no-store"
