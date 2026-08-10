"""LLM-Auswahl (PLAN §7 Phase 5).

Der Korpus ist vollständig öffentlich (ADR-0015), deshalb genügt eine Regel:
Mistral über die EU-API (AVV), sofern ein Schlüssel konfiguriert ist, sonst ein
lokales Ollama-Modell als Rückfallebene für die Entwicklung ohne API-Zugang.

Dieses Modul spricht selbst nie mit dem Netz; es *wählt* nur einen Client.
"""

from __future__ import annotations

from app.core.config import Settings, get_settings
from app.generation.llm import LLMClient, MistralChatClient, OllamaChatClient


def choose_client(*, settings: Settings | None = None) -> LLMClient:
    settings = settings or get_settings()
    if settings.mistral_api_key:
        return MistralChatClient(settings.mistral_api_key, settings.mistral_model)
    return OllamaChatClient(settings.ollama_llm_model, settings.ollama_base_url)
