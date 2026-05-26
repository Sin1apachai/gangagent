"""End-to-end-ish test for ClaudeProvider.chat() with the Anthropic SDK mocked.

Proves the wiring (system extraction → SDK call → response normalization) without
touching the network — closing the Phase 0 'simple chat works' goal.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from gangagent.core import Message, Role
from gangagent.providers import ProviderConfig
from gangagent.providers.implementations.claude import ClaudeProvider


def _fake_anthropic_message(text: str, model: str = "claude-test") -> SimpleNamespace:
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)],
        model=model,
        stop_reason="end_turn",
        usage=SimpleNamespace(
            input_tokens=12,
            output_tokens=34,
            cache_read_input_tokens=0,
            cache_creation_input_tokens=0,
        ),
        model_dump=lambda: {"id": "msg_mock", "model": model},
    )


@pytest.mark.asyncio
async def test_chat_returns_normalized_response() -> None:
    provider = ClaudeProvider(ProviderConfig(api_key="test", model="claude-test"))

    fake_create = AsyncMock(return_value=_fake_anthropic_message("hi from mock"))
    with patch.object(provider._client.messages, "create", fake_create):
        response = await provider.chat(
            [
                Message(role=Role.SYSTEM, content="be terse"),
                Message(role=Role.USER, content="say hi"),
            ],
            max_tokens=64,
        )

    assert response.content == "hi from mock"
    assert response.provider == "claude"
    assert response.model == "claude-test"
    assert response.finish_reason == "stop"
    assert response.usage.input_tokens == 12
    assert response.usage.output_tokens == 34

    # Verify the SDK was called with system pulled out + only non-system messages.
    fake_create.assert_awaited_once()
    kwargs = fake_create.await_args.kwargs
    assert kwargs["system"] == "be terse"
    assert kwargs["messages"] == [{"role": "user", "content": "say hi"}]
    assert kwargs["model"] == "claude-test"
    assert kwargs["max_tokens"] == 64


@pytest.mark.asyncio
async def test_chat_maps_max_tokens_stop_reason() -> None:
    provider = ClaudeProvider(ProviderConfig(api_key="test", model="claude-test"))
    fake_msg = _fake_anthropic_message("truncated")
    fake_msg.stop_reason = "max_tokens"

    with patch.object(
        provider._client.messages, "create", AsyncMock(return_value=fake_msg)
    ):
        response = await provider.chat([Message(role=Role.USER, content="hi")])

    assert response.finish_reason == "length"
