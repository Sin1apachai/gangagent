import pytest

from gangagent.capabilities import Capability
from gangagent.providers import ProviderRegistry


def test_discover_finds_claude() -> None:
    ProviderRegistry.discover()
    assert "claude" in ProviderRegistry.names()


def test_unknown_provider_raises() -> None:
    with pytest.raises(KeyError):
        ProviderRegistry.get("does-not-exist")


def test_claude_capabilities() -> None:
    ProviderRegistry.discover()
    cls = ProviderRegistry.get("claude")
    # Instantiate via the registry path without contacting the network
    from gangagent.providers import ProviderConfig

    provider = cls(ProviderConfig(api_key="test", model="claude-sonnet-4-5-20250929"))  # type: ignore[call-arg]
    assert provider.supports(Capability.TEXT_GENERATION)
    assert provider.supports(Capability.TOOL_USE)
    assert not provider.supports(Capability.AUDIO_INPUT)


def test_discover_finds_openai() -> None:
    ProviderRegistry.discover()
    assert "openai" in ProviderRegistry.names()


def test_openai_capabilities() -> None:
    ProviderRegistry.discover()
    cls = ProviderRegistry.get("openai")
    from gangagent.providers import ProviderConfig

    provider = cls(ProviderConfig(api_key="test", model="gpt-4o-mini"))  # type: ignore[call-arg]
    assert provider.supports(Capability.TEXT_GENERATION)
    assert provider.supports(Capability.STREAMING)
    assert provider.supports(Capability.TOOL_USE)
    assert provider.supports(Capability.STRUCTURED_OUTPUT)
    assert not provider.supports(Capability.AUDIO_INPUT)
    assert not provider.supports(Capability.THINKING_MODE)


def test_discover_finds_gemini() -> None:
    ProviderRegistry.discover()
    assert "gemini" in ProviderRegistry.names()


def test_gemini_capabilities() -> None:
    ProviderRegistry.discover()
    cls = ProviderRegistry.get("gemini")
    from gangagent.providers import ProviderConfig

    provider = cls(ProviderConfig(api_key="test", model="gemini-2.0-flash"))  # type: ignore[call-arg]
    assert provider.supports(Capability.TEXT_GENERATION)
    assert provider.supports(Capability.STREAMING)
    assert provider.supports(Capability.VISION)
    assert provider.supports(Capability.AUDIO_INPUT)
    assert provider.supports(Capability.LONG_CONTEXT_200K)
    assert not provider.supports(Capability.THINKING_MODE)
