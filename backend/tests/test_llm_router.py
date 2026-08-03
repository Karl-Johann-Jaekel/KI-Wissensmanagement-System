"""Zone router: confidential never leaves the machine (PLAN §2, §7 Phase 5 DoD)."""

from __future__ import annotations

from app.core.config import Settings
from app.core.llm_router import choose_client, zone_of
from app.generation.llm import MistralChatClient, OllamaChatClient


def test_zone_of_takes_highest() -> None:
    assert zone_of([]) == "public"
    assert zone_of(["public", "public"]) == "public"
    assert zone_of(["public", "confidential", "public"]) == "confidential"
    assert zone_of(["public", "internal"]) == "internal"


def test_confidential_routes_to_ollama_even_with_mistral_key() -> None:
    settings = Settings(mistral_api_key="sk-must-not-be-used")
    client = choose_client("confidential", settings=settings)
    assert isinstance(client, OllamaChatClient)
    assert client.name == "ollama"


def test_internal_also_stays_local() -> None:
    settings = Settings(mistral_api_key="sk-x")
    assert isinstance(choose_client("internal", settings=settings), OllamaChatClient)


def test_public_uses_mistral_when_key_present() -> None:
    settings = Settings(mistral_api_key="sk-x")
    client = choose_client("public", settings=settings)
    assert isinstance(client, MistralChatClient)


def test_public_falls_back_to_ollama_without_key() -> None:
    settings = Settings(mistral_api_key="")
    assert isinstance(choose_client("public", settings=settings), OllamaChatClient)


def test_model_override_applies_to_ollama(  # ADR-0008
) -> None:
    settings = Settings(mistral_api_key="")
    client = choose_client("confidential", settings=settings, model="gemma3:4b")
    assert isinstance(client, OllamaChatClient)
    assert client.model == "gemma3:4b"


def test_model_override_ignored_for_mistral() -> None:
    settings = Settings(mistral_api_key="sk-x")
    client = choose_client("public", settings=settings, model="gemma3:4b")
    assert isinstance(client, MistralChatClient)
    assert client.model == settings.mistral_model


def test_choose_client_positional_call_still_works() -> None:
    # app/update.py ruft choose_client("public") ohne Keywords auf.
    assert choose_client("public", settings=Settings(mistral_api_key="")).name == "ollama"
