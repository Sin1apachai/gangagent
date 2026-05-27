"""`gang db` subcommands — schema migration management."""

from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from gangagent.migrations import (
    MigrationDriftError,
    MigrationParseError,
    MigrationRunner,
    default_db_path,
    default_migrations_dir,
)

db_app = typer.Typer(name="db", help="Schema migration commands.", no_args_is_help=True)
console = Console()


def _runner(db: str | None, migrations: str | None) -> MigrationRunner:
    return MigrationRunner(
        db_path=Path(db) if db else default_db_path(),
        migrations_dir=Path(migrations) if migrations else default_migrations_dir(),
    )


@db_app.command()
def status(
    db: str | None = typer.Option(None, "--db", help="SQLite DB path"),
    migrations: str | None = typer.Option(None, "--migrations", help="Migrations dir"),
) -> None:
    """Show current schema version + pending migrations."""
    runner = _runner(db, migrations)
    try:
        st = runner.status()
    except MigrationParseError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from None

    console.print(f"[bold]DB:[/bold] {runner.db_path}")
    console.print(f"[bold]Current version:[/bold] {st.current or '(none)'}")
    if st.drift:
        console.print(f"[red]DRIFT detected on versions: {st.drift}[/red]")

    table = Table(title="Migrations")
    table.add_column("Version")
    table.add_column("Name")
    table.add_column("State")
    table.add_column("Applied At", style="dim")
    applied_by_v = {row.version: row for row in st.applied}
    for m in runner.discover():
        row = applied_by_v.get(m.version)
        state = "applied" if row else "pending"
        if row and m.version in st.drift:
            state = "applied (DRIFT)"
        table.add_row(m.version, m.name, state, row.applied_at if row else "—")
    console.print(table)


@db_app.command()
def migrate(
    to: str | None = typer.Option(None, "--to", help="Apply up to this version (inclusive)"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Show what would run"),
    db: str | None = typer.Option(None, "--db"),
    migrations: str | None = typer.Option(None, "--migrations"),
) -> None:
    """Apply all pending migrations (or up to --to)."""
    runner = _runner(db, migrations)
    try:
        applied = runner.migrate(to=to, dry_run=dry_run)
    except MigrationDriftError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from None

    if not applied:
        console.print("[green]nothing to do — schema is up to date[/green]")
        return

    verb = "would apply" if dry_run else "applied"
    for m in applied:
        console.print(f"[green]✓[/green] {verb} {m.version} {m.name}")


@db_app.command()
def rollback(
    to: str | None = typer.Option(
        None, "--to", help="Roll back to this version (exclusive). Default: one step."
    ),
    dry_run: bool = typer.Option(False, "--dry-run"),
    db: str | None = typer.Option(None, "--db"),
    migrations: str | None = typer.Option(None, "--migrations"),
) -> None:
    """Roll back applied migrations."""
    runner = _runner(db, migrations)
    try:
        rolled = runner.rollback(to=to, dry_run=dry_run)
    except MigrationParseError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from None

    if not rolled:
        console.print("[yellow]nothing to roll back[/yellow]")
        return

    verb = "would roll back" if dry_run else "rolled back"
    for m in rolled:
        console.print(f"[yellow]↩[/yellow] {verb} {m.version} {m.name}")


@db_app.command()
def new(
    name: str = typer.Argument(..., help="Snake-case migration name"),
    migrations: str | None = typer.Option(None, "--migrations"),
) -> None:
    """Scaffold a new empty migration file with the next sequential version."""
    runner = _runner(None, migrations)
    path = runner.scaffold(name)
    console.print(f"[green]created[/green] {path}")
