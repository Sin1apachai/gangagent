"""Capability config — declarative provider × capability matrix.

YAML at `data/configs/capabilities.yaml` lets the user extend a provider's
capabilities (e.g. after a vendor ships a new feature) without editing code.
The loader resolves env-relative paths, validates via Pydantic, and exposes a
small helper used by `CapabilityRouter`.
"""

from pathlib import Path

import yaml
from pydantic import BaseModel, Field

from gangagent.capabilities.base import Capability

CONFIG_SCHEMA_VERSION = 1


class ProviderCapabilityOverride(BaseModel):
    extra_supports: list[Capability] = Field(default_factory=list)


class CapabilityConfig(BaseModel):
    schema_version: int = CONFIG_SCHEMA_VERSION
    preferred_order: list[str] = Field(default_factory=list)
    providers: dict[str, ProviderCapabilityOverride] = Field(default_factory=dict)

    def extra_supports(self, provider: str) -> frozenset[Capability]:
        entry = self.providers.get(provider)
        return frozenset(entry.extra_supports) if entry else frozenset()

    @classmethod
    def load(cls, path: Path) -> "CapabilityConfig":
        raw = yaml.safe_load(path.read_text()) or {}
        config = cls.model_validate(raw)
        if config.schema_version != CONFIG_SCHEMA_VERSION:
            raise ValueError(
                f"capabilities.yaml schema_version={config.schema_version} "
                f"unsupported (expected {CONFIG_SCHEMA_VERSION})"
            )
        return config

    @classmethod
    def load_or_default(cls, path: Path | None) -> "CapabilityConfig":
        if path is not None and path.exists():
            return cls.load(path)
        return cls()


def default_config_path() -> Path:
    """Resolve `./data/configs/capabilities.yaml` relative to the cwd."""
    return Path.cwd() / "data" / "configs" / "capabilities.yaml"
