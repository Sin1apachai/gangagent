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
