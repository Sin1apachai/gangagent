"""Tests for CapabilityRouter + CapabilityConfig.

No SDK calls — uses tiny fake providers so we can exercise edge cases
(missing capability, extra_supports merge, preferred order, flexible/strict)
in isolation from real provider behavior.
"""

from pathlib import Path

import pytest

from gangagent.capabilities import (
    Capability,
    CapabilityConfig,
    CapabilityRouter,
    NoMatchingProviderError,
    ProviderCapabilityOverride,
)
from gangagent.providers.base import ProviderConfig


class _FakeProvider:
    """Stand-in IAgentProvider — only `supports()` matters for routing."""

    def __init__(self, name: str, caps: set[Capability]) -> None:
        self.name = name
        self.config = ProviderConfig(api_key="x", model="x")
        self._caps = caps

    def supports(self, capability: Capability) -> bool:
        return capability in self._caps

    async def chat(self, *a, **k):  # pragma: no cover - protocol shape only
        raise NotImplementedError

    async def stream(self, *a, **k):  # pragma: no cover - protocol shape only
        raise NotImplementedError


def _three_providers() -> dict[str, _FakeProvider]:
    return {
        "claude": _FakeProvider(
            "claude",
            {Capability.TEXT_GENERATION, Capability.TOOL_USE, Capability.THINKING_MODE},
        ),
        "openai": _FakeProvider(
            "openai",
            {Capability.TEXT_GENERATION, Capability.TOOL_USE, Capability.STRUCTURED_OUTPUT},
        ),
        "gemini": _FakeProvider(
            "gemini",
            {Capability.TEXT_GENERATION, Capability.VISION, Capability.AUDIO_INPUT},
        ),
    }


def test_strict_keeps_current_when_satisfied() -> None:
    router = CapabilityRouter(_three_providers())  # type: ignore[arg-type]
    decision = router.route(
        [Capability.TEXT_GENERATION, Capability.TOOL_USE],
        mode="strict",
        current="claude",
    )
    assert decision.provider == "claude"
    assert decision.fallback_from is None


def test_strict_errors_when_current_missing_capability() -> None:
    router = CapabilityRouter(_three_providers())  # type: ignore[arg-type]
    with pytest.raises(NoMatchingProviderError):
        router.route([Capability.VISION], mode="strict", current="claude")


def test_strict_requires_current() -> None:
    router = CapabilityRouter(_three_providers())  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        router.route([Capability.VISION], mode="strict")


def test_flexible_falls_back_to_preferred_order() -> None:
    cfg = CapabilityConfig(preferred_order=["openai", "gemini", "claude"])
    router = CapabilityRouter(_three_providers(), cfg)  # type: ignore[arg-type]
    decision = router.route([Capability.VISION], mode="flexible", current="claude")
    assert decision.provider == "gemini"
    assert decision.fallback_from == "claude"


def test_flexible_keeps_current_when_it_works() -> None:
    cfg = CapabilityConfig(preferred_order=["openai", "gemini", "claude"])
    router = CapabilityRouter(_three_providers(), cfg)  # type: ignore[arg-type]
    decision = router.route([Capability.TEXT_GENERATION], mode="flexible", current="claude")
    assert decision.provider == "claude"
    assert decision.fallback_from is None


def test_flexible_picks_preferred_when_no_current() -> None:
    cfg = CapabilityConfig(preferred_order=["gemini", "openai", "claude"])
    router = CapabilityRouter(_three_providers(), cfg)  # type: ignore[arg-type]
    decision = router.route([Capability.TEXT_GENERATION], mode="flexible")
    assert decision.provider == "gemini"


def test_flexible_no_match_raises() -> None:
    router = CapabilityRouter(_three_providers())  # type: ignore[arg-type]
    with pytest.raises(NoMatchingProviderError):
        router.route([Capability.WEB_SEARCH], mode="flexible")


def test_extra_supports_extends_provider() -> None:
    cfg = CapabilityConfig(
        providers={"openai": ProviderCapabilityOverride(extra_supports=[Capability.VISION])}
    )
    router = CapabilityRouter(_three_providers(), cfg)  # type: ignore[arg-type]
    # Code-declared openai has no VISION, YAML adds it → router accepts.
    decision = router.route([Capability.VISION], mode="strict", current="openai")
    assert decision.provider == "openai"


def test_config_load_from_yaml(tmp_path: Path) -> None:
    yaml_text = """
schema_version: 1
preferred_order: [openai, claude]
providers:
  openai:
    extra_supports: [vision]
"""
    p = tmp_path / "capabilities.yaml"
    p.write_text(yaml_text)
    cfg = CapabilityConfig.load(p)
    assert cfg.preferred_order == ["openai", "claude"]
    assert Capability.VISION in cfg.extra_supports("openai")
    assert cfg.extra_supports("gemini") == frozenset()


def test_config_load_or_default_when_missing(tmp_path: Path) -> None:
    cfg = CapabilityConfig.load_or_default(tmp_path / "nope.yaml")
    assert cfg.schema_version == 1
    assert cfg.preferred_order == []


def test_config_rejects_unknown_schema_version(tmp_path: Path) -> None:
    p = tmp_path / "capabilities.yaml"
    p.write_text("schema_version: 99\nproviders: {}\n")
    with pytest.raises(ValueError):
        CapabilityConfig.load(p)
