"""CapabilityRouter — pick a provider that satisfies a required capability set.

Two modes:
- **strict**: stay on `current` if it supports everything; else error.
- **flexible**: try `current` first, then walk `preferred_order`, then the rest.

Routing is read-only — it does not instantiate providers, just resolves a name.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from gangagent.capabilities.base import Capability
from gangagent.capabilities.config import CapabilityConfig
from gangagent.providers.base import IAgentProvider

RoutingMode = Literal["strict", "flexible"]


class NoMatchingProviderError(LookupError):
    """Raised when no provider satisfies the required capability set."""


@dataclass(frozen=True)
class RoutingDecision:
    provider: str
    matched_capabilities: frozenset[Capability]
    fallback_from: str | None  # set when flexible mode swapped away from `current`


class CapabilityRouter:
    def __init__(
        self,
        providers: dict[str, IAgentProvider],
        config: CapabilityConfig | None = None,
    ) -> None:
        self._providers = providers
        self._config = config or CapabilityConfig()

    def supports(self, provider_name: str, capability: Capability) -> bool:
        provider = self._providers.get(provider_name)
        if provider is None:
            return False
        if provider.supports(capability):
            return True
        return capability in self._config.extra_supports(provider_name)

    def supports_all(self, provider_name: str, required: Iterable[Capability]) -> bool:
        return all(self.supports(provider_name, c) for c in required)

    def _candidate_order(self, current: str | None) -> list[str]:
        ordered: list[str] = []
        seen: set[str] = set()

        def add(name: str) -> None:
            if name in seen or name not in self._providers:
                return
            ordered.append(name)
            seen.add(name)

        if current is not None:
            add(current)
        for name in self._config.preferred_order:
            add(name)
        for name in sorted(self._providers):
            add(name)
        return ordered

    def route(
        self,
        required: Iterable[Capability],
        *,
        mode: RoutingMode = "strict",
        current: str | None = None,
    ) -> RoutingDecision:
        required_set = frozenset(required)

        if mode == "strict":
            if current is None:
                raise ValueError("strict mode requires a `current` provider")
            if not self.supports_all(current, required_set):
                missing = sorted(c for c in required_set if not self.supports(current, c))
                raise NoMatchingProviderError(
                    f"strict mode: '{current}' missing capabilities {missing}"
                )
            return RoutingDecision(
                provider=current,
                matched_capabilities=required_set,
                fallback_from=None,
            )

        # flexible
        for name in self._candidate_order(current):
            if self.supports_all(name, required_set):
                return RoutingDecision(
                    provider=name,
                    matched_capabilities=required_set,
                    fallback_from=current if current and current != name else None,
                )

        raise NoMatchingProviderError(
            f"no provider supports {sorted(required_set)} (checked: {sorted(self._providers)})"
        )
