"""MCP server config — `data/configs/mcp_servers.yaml`.

Supports `${ENV_VAR}` interpolation everywhere (paths, tokens). Missing env
vars are loud — we never silently swap in an empty string, because an MCP
server spawned with a blank token will fail in confusing ways downstream.
"""

import os
import re
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, model_validator

CONFIG_SCHEMA_VERSION = 1
_ENV_PATTERN = re.compile(r"\$\{(?P<name>[A-Z_][A-Z0-9_]*)\}")


class MCPConfigError(ValueError):
    """Raised when mcp_servers.yaml is malformed or references a missing env var."""


class MCPServer(BaseModel):
    name: str
    transport: Literal["stdio", "sse"]
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    url: str | None = None
    env: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True

    @model_validator(mode="after")
    def _transport_requirements(self) -> "MCPServer":
        if self.transport == "stdio" and not self.command:
            raise MCPConfigError(f"server '{self.name}': stdio transport requires `command`")
        if self.transport == "sse" and not self.url:
            raise MCPConfigError(f"server '{self.name}': sse transport requires `url`")
        return self


class MCPServersConfig(BaseModel):
    schema_version: int = CONFIG_SCHEMA_VERSION
    servers: dict[str, MCPServer] = Field(default_factory=dict)

    def enabled_servers(self) -> list[MCPServer]:
        return [s for s in self.servers.values() if s.enabled]

    @classmethod
    def load(cls, path: Path) -> "MCPServersConfig":
        raw = yaml.safe_load(path.read_text()) or {}
        interpolated = _interpolate_env(raw)
        # Inject the dict key as `name` for each server entry — keeps YAML clean.
        servers_raw = interpolated.get("servers") or {}
        if isinstance(servers_raw, dict):
            for key, entry in servers_raw.items():
                if isinstance(entry, dict) and "name" not in entry:
                    entry["name"] = key
        try:
            config = cls.model_validate(interpolated)
        except Exception as e:
            raise MCPConfigError(str(e)) from e
        if config.schema_version != CONFIG_SCHEMA_VERSION:
            raise MCPConfigError(
                f"mcp_servers.yaml schema_version={config.schema_version} unsupported"
            )
        return config

    @classmethod
    def load_or_default(cls, path: Path | None) -> "MCPServersConfig":
        if path is not None and path.exists():
            return cls.load(path)
        return cls()


def _interpolate_env(obj: Any) -> Any:
    if isinstance(obj, str):
        return _ENV_PATTERN.sub(_replace_env, obj)
    if isinstance(obj, dict):
        return {k: _interpolate_env(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_interpolate_env(v) for v in obj]
    return obj


def _replace_env(match: re.Match[str]) -> str:
    name = match.group("name")
    if name not in os.environ:
        raise MCPConfigError(f"env var ${{{name}}} is not set")
    return os.environ[name]


def default_mcp_config_path() -> Path:
    return Path.cwd() / "data" / "configs" / "mcp_servers.yaml"
