"""Thin async wrapper over `mcp.ClientSession` for a single MCP server.

Use as an async context manager — `__aenter__` lazily spawns the stdio process
(or opens the SSE connection) and initializes the session; `__aexit__` tears
it down. Per `plan.md` best practice: stdio servers do not start at import
time, only when actually entered.
"""

import contextlib
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import TracebackType
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp import types as mcp_types
from mcp.client.sse import sse_client
from mcp.client.stdio import stdio_client

from gangagent.mcp.config import MCPServer


class MCPClient:
    def __init__(self, server: MCPServer) -> None:
        self.server = server
        self._session: ClientSession | None = None
        self._ctx_stack: list[Any] = []

    @property
    def session(self) -> ClientSession:
        if self._session is None:
            raise RuntimeError(
                f"MCPClient for '{self.server.name}' is not entered; use `async with client:`"
            )
        return self._session

    async def __aenter__(self) -> "MCPClient":
        cm = self._transport()
        read, write = await self._push(cm)
        session_cm = ClientSession(read, write)
        self._session = await self._push(session_cm)
        await self._session.initialize()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        # Unwind in reverse order so the session closes before the transport.
        while self._ctx_stack:
            cm = self._ctx_stack.pop()
            with contextlib.suppress(Exception):
                await cm.__aexit__(exc_type, exc, tb)
        self._session = None

    async def list_tools(self) -> list[mcp_types.Tool]:
        result = await self.session.list_tools()
        return list(result.tools)

    async def call_tool(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> mcp_types.CallToolResult:
        return await self.session.call_tool(name, arguments or {})

    # ---- internals ------------------------------------------------------

    @asynccontextmanager
    async def _transport(self) -> AsyncIterator[Any]:
        if self.server.transport == "stdio":
            assert self.server.command, "validated by MCPServer model"
            params = StdioServerParameters(
                command=self.server.command,
                args=list(self.server.args),
                env={**os.environ, **self.server.env},
            )
            async with stdio_client(params) as (read, write):
                yield read, write
        else:
            assert self.server.url, "validated by MCPServer model"
            async with sse_client(self.server.url) as (read, write):
                yield read, write

    async def _push(self, cm: Any) -> Any:
        value = await cm.__aenter__()
        self._ctx_stack.append(cm)
        return value
