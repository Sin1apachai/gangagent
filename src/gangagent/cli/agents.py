"""`gang agents` subcommands — agent registry + lifecycle."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from gangagent.agents import (
    AgentNotFoundError,
    AgentRepository,
    AgentState,
    InvalidTransitionError,
)

agents_app = typer.Typer(
    name="agents", help="Manage the agent registry + lifecycle.", no_args_is_help=True
)
console = Console()


def _repo(db: str | None) -> AgentRepository:
    return AgentRepository(db_path=Path(db) if db else None)


def _print_agent(agent) -> None:  # type: ignore[no-untyped-def]
    table = Table(show_header=False, box=None)
    table.add_row("id", agent.id)
    table.add_row("name", agent.name)
    table.add_row("provider", agent.provider)
    table.add_row("model", agent.model)
    table.add_row("state", agent.state.value)
    table.add_row("created_at", agent.created_at.isoformat())
    table.add_row("updated_at", agent.updated_at.isoformat())
    console.print(table)


@agents_app.command()
def create(
    name: str = typer.Option(..., "--name", "-n", help="Agent display name"),
    provider: str = typer.Option(..., "--provider", "-p"),
    model: str = typer.Option(..., "--model", "-m"),
    db: str | None = typer.Option(None, "--db"),
) -> None:
    """Register a new agent (starts in `spawning`)."""
    agent = _repo(db).create(name=name, provider=provider, model=model)
    console.print(f"[green]✓[/green] created {agent.id} [dim]({agent.state.value})[/dim]")
    _print_agent(agent)


@agents_app.command(name="list")
def list_cmd(
    state: str | None = typer.Option(None, "--state", "-s", help="Filter by state"),
    include_retired: bool = typer.Option(
        False, "--include-retired", help="Show retired agents (hidden by default)"
    ),
    db: str | None = typer.Option(None, "--db"),
) -> None:
    """List agents in the registry."""
    filter_state = AgentState(state) if state else None
    agents = _repo(db).list(state=filter_state, include_retired=include_retired)
    if not agents:
        console.print("[dim](no agents)[/dim]")
        return
    table = Table(title="Agents")
    table.add_column("ID", style="dim")
    table.add_column("Name")
    table.add_column("Provider")
    table.add_column("Model")
    table.add_column("State")
    for a in agents:
        table.add_row(a.id[:8], a.name, a.provider, a.model, a.state.value)
    console.print(table)


@agents_app.command()
def show(
    agent_id: str = typer.Argument(..., help="Full or short (>=8 char) agent id"),
    db: str | None = typer.Option(None, "--db"),
) -> None:
    """Show full details of one agent."""
    agent = _resolve(agent_id, _repo(db))
    _print_agent(agent)


@agents_app.command()
def transition(
    agent_id: str = typer.Argument(..., help="Agent id"),
    to: str = typer.Argument(..., help="Target state"),
    db: str | None = typer.Option(None, "--db"),
) -> None:
    """Advance an agent to a new lifecycle state."""
    repo = _repo(db)
    agent = _resolve(agent_id, repo)
    try:
        target = AgentState(to)
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from None
    try:
        updated = repo.transition(agent.id, target)
    except InvalidTransitionError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from None
    console.print(f"[green]→[/green] {agent.state.value} → {updated.state.value}")


@agents_app.command()
def sleep(
    agent_id: str = typer.Argument(...),
    db: str | None = typer.Option(None, "--db"),
) -> None:
    """Shortcut: `active → sleeping`."""
    _shortcut(agent_id, AgentState.SLEEPING, db)


@agents_app.command()
def wake(
    agent_id: str = typer.Argument(...),
    db: str | None = typer.Option(None, "--db"),
) -> None:
    """Shortcut: `sleeping → active`."""
    _shortcut(agent_id, AgentState.ACTIVE, db)


@agents_app.command()
def retire(
    agent_id: str = typer.Argument(...),
    db: str | None = typer.Option(None, "--db"),
) -> None:
    """Shortcut: `active|sleeping → retired` (terminal)."""
    _shortcut(agent_id, AgentState.RETIRED, db)


# ---- helpers -----------------------------------------------------------


def _resolve(agent_id: str, repo: AgentRepository):  # type: ignore[no-untyped-def]
    # Exact match first; fall back to unique short-prefix match.
    direct = repo.get(agent_id)
    if direct is not None:
        return direct
    if len(agent_id) >= 4:
        candidates = [a for a in repo.list(include_retired=True) if a.id.startswith(agent_id)]
        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) > 1:
            console.print(
                f"[red]ambiguous id prefix '{agent_id}' — {len(candidates)} matches[/red]"
            )
            raise typer.Exit(code=2)
    console.print(f"[red]no agent matching '{agent_id}'[/red]")
    raise typer.Exit(code=2)


def _shortcut(agent_id: str, to: AgentState, db: str | None) -> None:
    repo = _repo(db)
    agent = _resolve(agent_id, repo)
    try:
        updated = repo.transition(agent.id, to)
    except InvalidTransitionError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from None
    except AgentNotFoundError:
        console.print(f"[red]no agent {agent_id}[/red]")
        raise typer.Exit(code=2) from None
    console.print(f"[green]→[/green] {agent.state.value} → {updated.state.value}")
