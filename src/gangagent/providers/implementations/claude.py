from collections.abc import AsyncIterator

from anthropic import AsyncAnthropic

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
        Capability.THINKING_MODE,
        Capability.PROMPT_CACHING,
        Capability.STRUCTURED_OUTPUT,
        Capability.LONG_CONTEXT_200K,
    }
)


@register_provider("claude")
class ClaudeProvider:
    name = "claude"

    def __init__(self, config: ProviderConfig) -> None:
        self.config = config
        self._client = AsyncAnthropic(
            api_key=config.api_key,
            base_url=config.base_url,
            timeout=config.timeout_s,
        )

    def supports(self, capability: Capability) -> bool:
        return capability in _SUPPORTED

    @staticmethod
    def _to_anthropic_messages(messages: list[Message]) -> tuple[str | None, list[dict]]:
        system_parts: list[str] = []
        out: list[dict] = []
        for m in messages:
            if m.role is Role.SYSTEM:
                system_parts.append(m.content)
                continue
            role = "user" if m.role is Role.USER else "assistant"
            out.append({"role": role, "content": m.content})
        system = "\n\n".join(system_parts) if system_parts else None
        return system, out

    async def chat(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        max_tokens: int = 1024,
        temperature: float = 1.0,
    ) -> Response:
        embedded_system, anthropic_messages = self._to_anthropic_messages(messages)
        final_system = "\n\n".join(s for s in (system, embedded_system) if s)

        kwargs: dict = {
            "model": self.config.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": anthropic_messages,
        }
        if final_system:
            kwargs["system"] = final_system

        msg = await self._client.messages.create(**kwargs)

        text = "".join(
            block.text for block in msg.content if getattr(block, "type", None) == "text"
        )
        finish = "stop"
        if msg.stop_reason == "max_tokens":
            finish = "length"
        elif msg.stop_reason == "tool_use":
            finish = "tool_use"

        return Response(
            content=text,
            model=msg.model,
            provider=self.name,
            finish_reason=finish,  # type: ignore[arg-type]
            usage=Usage(
                input_tokens=msg.usage.input_tokens,
                output_tokens=msg.usage.output_tokens,
                cache_read_tokens=getattr(msg.usage, "cache_read_input_tokens", 0) or 0,
                cache_write_tokens=getattr(msg.usage, "cache_creation_input_tokens", 0) or 0,
            ),
            raw=msg.model_dump(),
        )

    async def stream(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        max_tokens: int = 1024,
        temperature: float = 1.0,
    ) -> AsyncIterator[str]:
        embedded_system, anthropic_messages = self._to_anthropic_messages(messages)
        final_system = "\n\n".join(s for s in (system, embedded_system) if s)

        kwargs: dict = {
            "model": self.config.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": anthropic_messages,
        }
        if final_system:
            kwargs["system"] = final_system

        async with self._client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text
