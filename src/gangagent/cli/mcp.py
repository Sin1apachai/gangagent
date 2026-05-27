"""`gang mcp` subcommands — list servers, discover tools, validate config."""

import asyncio
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from gangagent.mcp import (
    MCPClient,
    MCPConfigError,
    MCPRegistry,
    MCPRegistryEntry,
    MCPServersConfig,
    default_mcp_config_path,
)

mcp_app = typer.Typer(name="mcp", help="Model Context Protocol commands.", no_args_is_help=True)
console = Console()


def _load(config_path: str | None) -> MCPServersConfig:
    path = Path(config_path) if config_path else default_mcp_config_path()
    try:
        return MCPServersConfig.load_or_default(path)
    except MCPConfigError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from None


@mcp_app.command("list")
def list_servers(
    config_path: str | None = typer.Option(None, "--config", "-c"),
) -> None:
    """Show configured MCP servers."""
    config = _load(config_path)
    if not config.servers:
        console.print("[dim](no servers configured)[/dim]")
        return

    table = Table(title="MCP Servers")
    table.add_column("Name", style="bold")
    table.add_column("Transport")
    table.add_column("Target")
    table.add_column("Enabled", justify="center")
    for server in config.servers.values():
        target = server.command or server.url or ""
        if server.args:
            target = f"{target} {' '.join(server.args)}"
        table.add_row(
            server.name,
            server.transport,
            target,
            "✓" if server.enabled else "·",
        )
    console.print(table)


@mcp_app.command()
def tools(
    config_path: str | None = typer.Option(None, "--config", "-c"),
) -> None:
    """Discover tools across every enabled MCP server (spawns each)."""
    config = _load(config_path)
    registry = MCPRegistry(config)

    async def run() -> list[MCPRegistryEntry]:
        return await registry.discover_tools()

    try:
        entries = asyncio.run(run())
    except Exception as e:
        console.print(f"[red]{type(e).__name__}: {e}[/red]")
        raise typer.Exit(code=1) from None

    if not entries:
        console.print("[dim](no tools discovered)[/dim]")
        return

    table = Table(title="MCP Tools")
    table.add_column("Server")
    table.add_column("Tool", style="bold")
    table.add_column("Description")
    for entry in entries:
        table.add_row(entry.server, entry.tool.name, entry.tool.description)
    console.print(table)


@mcp_app.command()
def test(
    server: str = typer.Argument(..., help="Server name from config"),
    config_path: str | None = typer.Option(None, "--config", "-c"),
) -> None:
    """Spawn a single MCP server and list its tools (validates config + connection)."""
    config = _load(config_path)
    if server not in config.servers:
        console.print(f"[red]unknown server '{server}'[/red]")
        raise typer.Exit(code=2)

    target = config.servers[server]

    async def run() -> int:
        async with MCPClient(target) as client:
            tools_list = await client.list_tools()
        console.print(f"[green]✓[/green] {server}: {len(tools_list)} tool(s)")
        for t in tools_list:
            console.print(f"  · [bold]{t.name}[/bold] — {t.description or '(no description)'}")
        return len(tools_list)

    try:
        asyncio.run(run())
    except Exception as e:
        console.print(f"[red]{type(e).__name__}: {e}[/red]")
        raise typer.Exit(code=1) from None


@mcp_app.command()
def reload(
    config_path: str | None = typer.Option(None, "--config", "-c"),
) -> None:
    """Re-parse the MCP config file (validates without spawning anything)."""
    config = _load(config_path)
    console.print(
        f"[green]✓[/green] {len(config.servers)} server(s) configured, "
        f"{len(config.enabled_servers())} enabled"
    )
