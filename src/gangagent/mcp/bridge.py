"""Bridge between MCP's `Tool` and our provider-neutral `gangagent.tools.Tool`.

MCP uses camelCase (`inputSchema`); ours uses snake_case (`input_schema`).
Once converted, the existing `tools/adapters.py` re-emits the right shape for
Claude/OpenAI/Gemini — no second adapter needed.
"""

from collections.abc import Iterable
from typing import Any

from mcp import types as mcp_types

from gangagent.tools.schema import Tool


def mcp_tool_to_tool(mt: mcp_types.Tool) -> Tool:
    schema: dict[str, Any] = (
        dict(mt.inputSchema)
        if mt.inputSchema
        else {
            "type": "object",
            "properties": {},
        }
    )
    return Tool(
        name=mt.name,
        description=mt.description or "",
        input_schema=schema,
    )


def mcp_tools_to_tools(mts: Iterable[mcp_types.Tool]) -> list[Tool]:
    return [mcp_tool_to_tool(t) for t in mts]
