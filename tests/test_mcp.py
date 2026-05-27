"""Tests for the MCP integration.

Covers:
- Config parsing + ${ENV} interpolation (happy + missing var raises)
- Transport validation (stdio needs command, sse needs url)
- Bridge: mcp.types.Tool → gangagent.tools.Tool, end-to-end into adapters
- Live filesystem-server test gated behind GANG_LIVE_MCP=1 (Phase 1 DoD locally)
"""

import os
from pathlib import Path

import pytest
from mcp import types as mcp_types

from gangagent.mcp import (
    MCPConfigError,
    MCPRegistry,
    MCPServer,
    MCPServersConfig,
    mcp_tool_to_tool,
    mcp_tools_to_tools,
)
from gangagent.tools import bundle_for

# ----------------------------------------------------------------- config


def test_config_env_interpolation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLOWED_PATH", "/tmp/sandbox")
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_abc")
    yaml_text = """
schema_version: 1
servers:
  filesystem:
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "${ALLOWED_PATH}"]
  gh:
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
"""
    p = tmp_path / "mcp_servers.yaml"
    p.write_text(yaml_text)
    cfg = MCPServersConfig.load(p)
    assert cfg.servers["filesystem"].args[-1] == "/tmp/sandbox"
    assert cfg.servers["gh"].env["GITHUB_PERSONAL_ACCESS_TOKEN"] == "ghp_abc"


def test_config_missing_env_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DOES_NOT_EXIST", raising=False)
    p = tmp_path / "mcp.yaml"
    p.write_text(
        "schema_version: 1\nservers:\n  x:\n    transport: stdio\n"
        '    command: foo\n    args: ["${DOES_NOT_EXIST}"]\n'
    )
    with pytest.raises(MCPConfigError, match="DOES_NOT_EXIST"):
        MCPServersConfig.load(p)


def test_stdio_server_requires_command() -> None:
    with pytest.raises(ValueError):
        MCPServer(name="x", transport="stdio")


def test_sse_server_requires_url() -> None:
    with pytest.raises(ValueError):
        MCPServer(name="x", transport="sse")


def test_enabled_servers_filter() -> None:
    cfg = MCPServersConfig(
        servers={
            "a": MCPServer(name="a", transport="stdio", command="echo", enabled=True),
            "b": MCPServer(name="b", transport="stdio", command="echo", enabled=False),
        }
    )
    enabled = cfg.enabled_servers()
    assert [s.name for s in enabled] == ["a"]


def test_load_or_default_when_missing(tmp_path: Path) -> None:
    cfg = MCPServersConfig.load_or_default(tmp_path / "nope.yaml")
    assert cfg.servers == {}


# ----------------------------------------------------------------- bridge


def _mcp_tool(name: str = "read_file") -> mcp_types.Tool:
    return mcp_types.Tool(
        name=name,
        description=f"{name} description",
        inputSchema={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    )


def test_bridge_converts_single_tool() -> None:
    t = mcp_tool_to_tool(_mcp_tool())
    assert t.name == "read_file"
    assert t.input_schema["properties"]["path"]["type"] == "string"


def test_bridge_handles_empty_schema() -> None:
    # MCP requires inputSchema; an empty object schema is the canonical "no args".
    mt = mcp_types.Tool(name="ping", description="ping", inputSchema={})
    t = mcp_tool_to_tool(mt)
    assert t.input_schema == {"type": "object", "properties": {}}


def test_bridge_then_adapt_to_each_vendor() -> None:
    """MCP tool → our Tool → vendor wire formats. Phase 1 'one adapter' check."""
    tools = mcp_tools_to_tools([_mcp_tool("read_file"), _mcp_tool("write_file")])
    for vendor in ("claude", "openai", "gemini"):
        bundle = bundle_for(vendor, tools)
        assert bundle  # each vendor produces something non-empty


# ----------------------------------------------------------------- registry (mocked)


@pytest.mark.asyncio
async def test_registry_skips_disabled_servers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Registry must never spawn a disabled server. We assert that by failing
    hard inside the spawn path — if it gets called, the test will explode."""
    from gangagent.mcp import client as client_mod

    async def boom(*a, **k):  # pragma: no cover - reached only if test fails
        raise AssertionError("disabled server must not be spawned")

    monkeypatch.setattr(client_mod, "stdio_client", boom)

    cfg = MCPServersConfig(
        servers={
            "off": MCPServer(name="off", transport="stdio", command="echo", enabled=False),
        }
    )
    registry = MCPRegistry(cfg)
    entries = await registry.discover_tools()
    assert entries == []


# ----------------------------------------------------------------- live (opt-in)


@pytest.mark.skipif(
    os.getenv("GANG_LIVE_MCP") != "1",
    reason="set GANG_LIVE_MCP=1 to run live filesystem MCP server test",
)
@pytest.mark.asyncio
async def test_live_filesystem_server(tmp_path: Path) -> None:
    """DoD gate: real `@modelcontextprotocol/server-filesystem` lists tools.

    Skipped by default — requires `npx` + network. Run locally with:
        GANG_LIVE_MCP=1 uv run pytest tests/test_mcp.py::test_live_filesystem_server -q
    """
    from gangagent.mcp.client import MCPClient

    server = MCPServer(
        name="filesystem",
        transport="stdio",
        command="npx",
        args=["-y", "@modelcontextprotocol/server-filesystem", str(tmp_path)],
    )
    async with MCPClient(server) as client:
        tools = await client.list_tools()
    assert tools, "filesystem server returned no tools"
    assert any("read" in t.name.lower() for t in tools)
