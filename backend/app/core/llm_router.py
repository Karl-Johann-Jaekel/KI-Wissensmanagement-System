"""LLM-Auswahl (PLAN §7 Phase 5, ADR-0021).

Der Korpus ist vollständig öffentlich (ADR-0015), die Wahl richtet sich deshalb
allein nach Kosten und Verfügbarkeit:

1. **Groq und Mistral** konfiguriert → Groq antwortet, Mistral steht dahinter.
   Groqs freier Tarif trägt den Normalbetrieb; sein enges Minutenkontingent
   fängt der Rückfall ab, statt die Antwort abbrechen zu lassen.
2. **Nur einer von beiden** → dieser, ohne Rückfallebene.
3. **Keiner** → lokales Ollama, damit Entwicklung ohne API-Zugang läuft.

Der Mistral-Schlüssel wird ohnehin gebraucht: Groq hat keinen Embedding-Endpunkt,
und der Bestand trägt ``mistral-embed`` (ADR-0002, ADR-0014).

Dieses Modul spricht selbst nie mit dem Netz; es *wählt* nur einen Client.
"""

from __future__ import annotations

from app.core.config import Settings, get_settings
from app.generation.llm import (
    FallbackChatClient,
    GroqChatClient,
    LLMClient,
    MistralChatClient,
    OllamaChatClient,
)


def choose_client(*, settings: Settings | None = None) -> LLMClient:
    settings = settings or get_settings()
    groq = (
        GroqChatClient(settings.groq_api_key, settings.groq_model)
        if settings.groq_api_key
        else None
    )
    mistral = (
        MistralChatClient(settings.mistral_api_key, settings.mistral_model)
        if settings.mistral_api_key
        else None
    )
    if groq and mistral:
        return FallbackChatClient(groq, mistral)
    if groq or mistral:
        return groq or mistral  # type: ignore[return-value]
    return OllamaChatClient(settings.ollama_llm_model, settings.ollama_base_url)
