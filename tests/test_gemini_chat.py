"""Wiring test for GeminiProvider.chat() with google-genai mocked.

Verifies system-instruction extraction, role mapping (assistant→model),
finish-reason mapping, and usage normalization without contacting the network.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from google.genai import types as gtypes

from gangagent.core import Message, Role
from gangagent.providers import ProviderConfig
from gangagent.providers.implementations.gemini import GeminiProvider


def _fake_result(
    text: str,
    *,
    finish_reason: gtypes.FinishReason = gtypes.FinishReason.STOP,
) -> SimpleNamespace:
    return SimpleNamespace(
        text=text,
        candidates=[SimpleNamespace(finish_reason=finish_reason)],
        usage_metadata=SimpleNamespace(
            prompt_token_count=12,
            candidates_token_count=34,
            cached_content_token_count=7,
        ),
        model_dump=lambda: {"id": "gen_mock"},
    )


@pytest.mark.asyncio
async def test_chat_returns_normalized_response() -> None:
    provider = GeminiProvider(ProviderConfig(api_key="test", model="gemini-test"))

    fake = AsyncMock(return_value=_fake_result("hi from mock"))
    with patch.object(provider._client.aio.models, "generate_content", fake):
        response = await provider.chat(
            [
                Message(role=Role.SYSTEM, content="embedded sys"),
                Message(role=Role.USER, content="say hi"),
                Message(role=Role.ASSISTANT, content="prior reply"),
            ],
            system="top sys",
            max_tokens=64,
        )

    assert response.content == "hi from mock"
    assert response.provider == "gemini"
    assert response.model == "gemini-test"
    assert response.finish_reason == "stop"
    assert response.usage.input_tokens == 12
    assert response.usage.output_tokens == 34
    assert response.usage.cache_read_tokens == 7

    fake.assert_awaited_once()
    kwargs = fake.await_args.kwargs
    assert kwargs["model"] == "gemini-test"

    # system_instruction merges top-level + embedded SYSTEM message
    assert kwargs["config"].system_instruction == "top sys\n\nembedded sys"
    assert kwargs["config"].max_output_tokens == 64

    contents = kwargs["contents"]
    assert [c.role for c in contents] == ["user", "model"]
    assert contents[0].parts[0].text == "say hi"
    assert contents[1].parts[0].text == "prior reply"


@pytest.mark.asyncio
async def test_chat_maps_finish_reasons() -> None:
    provider = GeminiProvider(ProviderConfig(api_key="test", model="gemini-test"))
    fr = gtypes.FinishReason
    cases = {
        fr.STOP: "stop",
        fr.MAX_TOKENS: "length",
        fr.MALFORMED_FUNCTION_CALL: "tool_use",
        fr.SAFETY: "error",
    }
    for gemini_reason, expected in cases.items():
        fake = _fake_result("x", finish_reason=gemini_reason)
        with patch.object(
            provider._client.aio.models,
            "generate_content",
            AsyncMock(return_value=fake),
        ):
            response = await provider.chat([Message(role=Role.USER, content="hi")])
        assert response.finish_reason == expected, gemini_reason
