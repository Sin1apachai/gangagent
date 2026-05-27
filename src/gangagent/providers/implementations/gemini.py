from collections.abc import AsyncIterator
from typing import Any

from google import genai
from google.genai import types as gtypes

from gangagent.capabilities import Capability
from gangagent.core import Message, Response, Role, Usage
from gangagent.providers.base import ProviderConfig
from gangagent.providers.registry import register_provider

_SUPPORTED: frozenset[Capability] = frozenset(
    {
        Capability.TEXT_GENERATION,
        Capability.STREAMING,
        Capability.TOOL_USE,
        Capability.VISION,
        Capability.AUDIO_INPUT,
        Capability.STRUCTURED_OUTPUT,
        Capability.PROMPT_CACHING,
        Capability.LONG_CONTEXT_200K,
    }
)


@register_provider("gemini")
class GeminiProvider:
    name = "gemini"

    def __init__(self, config: ProviderConfig) -> None:
        self.config = config
        self._client = genai.Client(api_key=config.api_key)

    def supports(self, capability: Capability) -> bool:
        return capability in _SUPPORTED

    @staticmethod
    def _split_messages(
        messages: list[Message], system: str | None
    ) -> tuple[str | None, list[gtypes.Content]]:
        """Pull SYSTEM messages out (merged with the top-level system arg) and
        convert the rest to Gemini Content (role: user|model)."""
        system_parts: list[str] = []
        if system:
            system_parts.append(system)
        contents: list[gtypes.Content] = []
        for m in messages:
            if m.role is Role.SYSTEM:
                system_parts.append(m.content)
                continue
            role = "user" if m.role is Role.USER else "model"
            contents.append(gtypes.Content(role=role, parts=[gtypes.Part(text=m.content)]))
        final_system = "\n\n".join(system_parts) if system_parts else None
        return final_system, contents

    @staticmethod
    def _map_finish(reason: Any) -> str:
        fr = gtypes.FinishReason
        if reason is None or reason == fr.STOP:
            return "stop"
        if reason == fr.MAX_TOKENS:
            return "length"
        if reason in (fr.MALFORMED_FUNCTION_CALL, fr.UNEXPECTED_TOOL_CALL):
            return "tool_use"
        return "error"

    def _build_config(
        self, system: str | None, max_tokens: int, temperature: float
    ) -> gtypes.GenerateContentConfig:
        return gtypes.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=max_tokens,
            temperature=temperature,
        )

    async def chat(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        max_tokens: int = 1024,
        temperature: float = 1.0,
    ) -> Response:
        final_system, contents = self._split_messages(messages, system)
        result = await self._client.aio.models.generate_content(
            model=self.config.model,
            contents=contents,
            config=self._build_config(final_system, max_tokens, temperature),
        )

        text = result.text or ""
        finish_reason: Any = None
        if result.candidates:
            finish_reason = result.candidates[0].finish_reason

        meta = result.usage_metadata
        input_tokens = (meta.prompt_token_count or 0) if meta else 0
        output_tokens = (meta.candidates_token_count or 0) if meta else 0
        cache_read = (meta.cached_content_token_count or 0) if meta else 0

        return Response(
            content=text,
            model=self.config.model,
            provider=self.name,
            finish_reason=self._map_finish(finish_reason),  # type: ignore[arg-type]
            usage=Usage(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_read_tokens=cache_read,
                cache_write_tokens=0,
            ),
            raw=result.model_dump() if hasattr(result, "model_dump") else None,
        )

    async def stream(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        max_tokens: int = 1024,
        temperature: float = 1.0,
    ) -> AsyncIterator[str]:
        final_system, contents = self._split_messages(messages, system)
        stream = await self._client.aio.models.generate_content_stream(
            model=self.config.model,
            contents=contents,
            config=self._build_config(final_system, max_tokens, temperature),
        )
        async for chunk in stream:
            if chunk.text:
                yield chunk.text
