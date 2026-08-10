"""LLM-Auswahl: Mistral wenn Schlüssel vorhanden, sonst lokaler Fallback."""

from __future__ import annotations

from app.core.config import Settings
from app.core.llm_router import choose_client
from app.generation.llm import MistralChatClient, OllamaChatClient


def test_uses_mistral_when_key_present() -> None:
    client = choose_client(settings=Settings(mistral_api_key="sk-x"))
    assert isinstance(client, MistralChatClient)
    assert client.name == "mistral"


def test_falls_back_to_ollama_without_key() -> None:
    client = choose_client(settings=Settings(mistral_api_key=""))
    assert isinstance(client, OllamaChatClient)
    assert client.name == "ollama"
