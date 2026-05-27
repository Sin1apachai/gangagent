from collections.abc import AsyncIterator

from openai import AsyncOpenAI

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
        Capability.PROMPT_CACHING,
        Capability.STRUCTURED_OUTPUT,
    }
)

_ROLE_MAP: dict[Role, str] = {
    Role.SYSTEM: "system",
    Role.USER: "user",
    Role.ASSISTANT: "assistant",
    Role.TOOL: "tool",
}


@register_provider("openai")
class OpenAIProvider:
    name = "openai"

    def __init__(self, config: ProviderConfig) -> None:
        self.config = config
        self._client = AsyncOpenAI(
            api_key=config.api_key,
            base_url=config.base_url,
            timeout=config.timeout_s,
        )

    def supports(self, capability: Capability) -> bool:
        return capability in _SUPPORTED

    @staticmethod
    def _to_openai_messages(messages: list[Message], system: str | None) -> list[dict[str, str]]:
        out: list[dict[str, str]] = []
        if system:
            out.append({"role": "system", "content": system})
        for m in messages:
            out.append({"role": _ROLE_MAP[m.role], "content": m.content})
        return out

    @staticmethod
    def _map_finish(reason: str | None) -> str:
        if reason == "length":
            return "length"
        if reason == "tool_calls":
            return "tool_use"
        if reason == "content_filter":
            return "error"
        return "stop"

    async def chat(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        max_tokens: int = 1024,
        temperature: float = 1.0,
    ) -> Response:
        completion = await self._client.chat.completions.create(
            model=self.config.model,
            messages=self._to_openai_messages(messages, system),  # type: ignore[arg-type]
            max_tokens=max_tokens,
            temperature=temperature,
        )

        choice = completion.choices[0]
        text = choice.message.content or ""

        usage = completion.usage
        input_tokens = usage.prompt_tokens if usage else 0
        output_tokens = usage.completion_tokens if usage else 0
        cache_read = 0
        if usage is not None:
            details = getattr(usage, "prompt_tokens_details", None)
            if details is not None:
                cache_read = getattr(details, "cached_tokens", 0) or 0

        return Response(
            content=text,
            model=completion.model,
            provider=self.name,
            finish_reason=self._map_finish(choice.finish_reason),  # type: ignore[arg-type]
            usage=Usage(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_read_tokens=cache_read,
                cache_write_tokens=0,
            ),
            raw=completion.model_dump(),
        )

    async def stream(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        max_tokens: int = 1024,
        temperature: float = 1.0,
    ) -> AsyncIterator[str]:
        stream_resp = await self._client.chat.completions.create(
            model=self.config.model,
            messages=self._to_openai_messages(messages, system),  # type: ignore[arg-type]
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True,
        )
        async for chunk in stream_resp:  # type: ignore[union-attr]
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
