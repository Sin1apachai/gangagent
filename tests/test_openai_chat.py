"""Wiring test for OpenAIProvider.chat() with the OpenAI SDK mocked.

Verifies system-merge, message format conversion, finish-reason mapping, and
usage normalization without contacting the network.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from gangagent.core import Message, Role
from gangagent.providers import ProviderConfig
from gangagent.providers.implementations.openai import OpenAIProvider


def _fake_completion(
    text: str,
    *,
    model: str = "gpt-test",
    finish_reason: str = "stop",
) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=text),
                finish_reason=finish_reason,
            )
        ],
        model=model,
        usage=SimpleNamespace(
            prompt_tokens=12,
            completion_tokens=34,
            prompt_tokens_details=SimpleNamespace(cached_tokens=5),
        ),
        model_dump=lambda: {"id": "cmpl_mock", "model": model},
    )


@pytest.mark.asyncio
async def test_chat_returns_normalized_response() -> None:
    provider = OpenAIProvider(ProviderConfig(api_key="test", model="gpt-test"))

    fake_create = AsyncMock(return_value=_fake_completion("hi from mock"))
    with patch.object(provider._client.chat.completions, "create", fake_create):
        response = await provider.chat(
            [
                Message(role=Role.SYSTEM, content="embedded sys"),
                Message(role=Role.USER, content="say hi"),
            ],
            system="top sys",
            max_tokens=64,
        )

    assert response.content == "hi from mock"
    assert response.provider == "openai"
    assert response.model == "gpt-test"
    assert response.finish_reason == "stop"
    assert response.usage.input_tokens == 12
    assert response.usage.output_tokens == 34
    assert response.usage.cache_read_tokens == 5

    fake_create.assert_awaited_once()
    kwargs = fake_create.await_args.kwargs
    # `system` arg is prepended; embedded SYSTEM messages stay in-band as a system role.
    assert kwargs["messages"] == [
        {"role": "system", "content": "top sys"},
        {"role": "system", "content": "embedded sys"},
        {"role": "user", "content": "say hi"},
    ]
    assert kwargs["model"] == "gpt-test"
    assert kwargs["max_tokens"] == 64


@pytest.mark.asyncio
async def test_chat_maps_finish_reasons() -> None:
    provider = OpenAIProvider(ProviderConfig(api_key="test", model="gpt-test"))

    cases = {
        "length": "length",
        "tool_calls": "tool_use",
        "content_filter": "error",
        "stop": "stop",
    }
    for openai_reason, expected in cases.items():
        fake = _fake_completion("x", finish_reason=openai_reason)
        with patch.object(
            provider._client.chat.completions, "create", AsyncMock(return_value=fake)
        ):
            response = await provider.chat([Message(role=Role.USER, content="hi")])
        assert response.finish_reason == expected, openai_reason
