from collections.abc import AsyncIterator
from typing import Protocol, runtime_checkable

from pydantic import BaseModel

from gangagent.capabilities import Capability
from gangagent.core import Message, Response


class ProviderConfig(BaseModel):
    api_key: str | None = None
    model: str
    base_url: str | None = None
    timeout_s: float = 60.0
    extra: dict = {}


@runtime_checkable
class IAgentProvider(Protocol):
    """Provider-neutral interface every implementation must satisfy."""

    name: str
    config: ProviderConfig

    def supports(self, capability: Capability) -> bool: ...

    async def chat(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        max_tokens: int = 1024,
        temperature: float = 1.0,
    ) -> Response: ...

    async def stream(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        max_tokens: int = 1024,
        temperature: float = 1.0,
    ) -> AsyncIterator[str]: ...
