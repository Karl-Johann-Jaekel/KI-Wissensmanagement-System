"""Zone-based LLM routing (PLAN §2, §7 Phase 5).

The highest sensitivity among the retrieved hits decides the model:
- any hit that is not ``public`` (i.e. confidential/internal) -> **local Ollama only**,
  provably no external call;
- purely ``public`` -> Mistral EU API (AVV) if a key is configured, otherwise Ollama
  as a local fallback.

This module never talks to a network itself; it only *chooses* a client.
"""

from __future__ import annotations

from app.core.config import Settings, get_settings
from app.generation.llm import LLMClient, MistralChatClient, OllamaChatClient
from app.retrieval.hybrid import SENS_ORDER


def zone_of(sensitivities: list[str]) -> str:
    """Highest sensitivity present (empty -> 'public')."""
    if not sensitivities:
        return "public"
    return max(sensitivities, key=lambda s: SENS_ORDER[s])


def choose_client(zone: str, *, settings: Settings | None = None) -> LLMClient:
    settings = settings or get_settings()
    if zone != "public":
        # confidential / internal never leave the machine.
        return OllamaChatClient(settings.ollama_llm_model, settings.ollama_base_url)
    if settings.mistral_api_key:
        return MistralChatClient(settings.mistral_api_key, settings.mistral_model)
    return OllamaChatClient(settings.ollama_llm_model, settings.ollama_base_url)
