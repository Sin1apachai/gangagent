"""MCPRegistry — aggregate tools across multiple MCP servers.

Servers spawn lazily: `discover_tools()` opens each enabled server, reads the
tool list, then tears the connection down. For long-lived agent sessions a
future iteration will keep clients hot — for Phase 1 the lazy pattern is fine
and matches the `plan.md` guidance.
"""

from dataclasses import dataclass

from gangagent.mcp.bridge import mcp_tool_to_tool
from gangagent.mcp.client import MCPClient
from gangagent.mcp.config import MCPServer, MCPServersConfig
from gangagent.tools.schema import Tool


@dataclass(frozen=True)
class MCPRegistryEntry:
    server: str
    tool: Tool


class MCPRegistry:
    def __init__(self, config: MCPServersConfig) -> None:
        self.config = config

    async def discover_tools(self) -> list[MCPRegistryEntry]:
        """Spawn each enabled server, list its tools, then tear it down."""
        entries: list[MCPRegistryEntry] = []
        for server in self.config.enabled_servers():
            entries.extend(await self._discover_one(server))
        return entries

    async def _discover_one(self, server: MCPServer) -> list[MCPRegistryEntry]:
        async with MCPClient(server) as client:
            mcp_tools = await client.list_tools()
        return [MCPRegistryEntry(server=server.name, tool=mcp_tool_to_tool(mt)) for mt in mcp_tools]
