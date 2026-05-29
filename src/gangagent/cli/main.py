import asyncio

import typer
from rich.console import Console
from rich.table import Table

from gangagent.capabilities import (
    Capability,
    CapabilityConfig,
    CapabilityRouter,
    NoMatchingProviderError,
    default_config_path,
)
from gangagent.cli.agents import agents_app
from gangagent.cli.db import db_app
from gangagent.cli.mcp import mcp_app
from gangagent.config import load_settings
from gangagent.core import Message, Role
from gangagent.providers import IAgentProvider, ProviderConfig, ProviderRegistry

app = typer.Typer(
    name="gang",
    help="gangAgent — multi-provider AI agent orchestration.",
    no_args_is_help=True,
)
app.add_typer(agents_app)
app.add_typer(db_app)
app.add_typer(mcp_app)
console = Console()


_API_KEY_ATTR: dict[str, tuple[str, str]] = {
    "claude": ("anthropic_api_key", "ANTHROPIC_API_KEY"),
    "openai": ("openai_api_key", "OPENAI_API_KEY"),
    "gemini": ("gemini_api_key", "GEMINI_API_KEY"),
}


def _make_provider(provider_name: str, model: str | None):
    settings = load_settings()
    name = provider_name or settings.gang_default_provider
    selected_model = model or settings.gang_default_model

    api_key: str | None = None
    if name in _API_KEY_ATTR:
        attr, env = _API_KEY_ATTR[name]
        api_key = getattr(settings, attr)
        if not api_key:
            console.print(f"[red]{env} not set.[/red] Copy .env.example to .env and fill it in.")
            raise typer.Exit(code=2)

    ProviderRegistry.discover()
    config = ProviderConfig(api_key=api_key, model=selected_model)
    return ProviderRegistry.create(name, config), selected_model


@app.command()
def providers() -> None:
    """List registered providers."""
    ProviderRegistry.discover()
    for n in ProviderRegistry.names():
        console.print(f"- {n}")


def _instantiate_all_providers() -> dict[str, IAgentProvider]:
    """Instantiate every registered provider with a dummy api_key.

    Capability inspection and routing never call the network, so the dummy is
    safe — same pattern as `tests/test_registry.py`.
    """
    ProviderRegistry.discover()
    out: dict[str, IAgentProvider] = {}
    for name in ProviderRegistry.names():
        config = ProviderConfig(api_key="cap-inspect", model="cap-inspect")
        out[name] = ProviderRegistry.create(name, config)
    return out


@app.command()
def capabilities(
    config_path: str | None = typer.Option(
        None, "--config", "-c", help="Path to capabilities.yaml (defaults to data/configs/)"
    ),
) -> None:
    """Show provider × capability matrix (✓ = supported)."""
    from pathlib import Path

    cap_config = CapabilityConfig.load_or_default(
        Path(config_path) if config_path else default_config_path()
    )
    router = CapabilityRouter(_instantiate_all_providers(), cap_config)

    table = Table(title="Provider × Capability")
    table.add_column("Capability", style="bold")
    for name in sorted(router._providers):
        table.add_column(name, justify="center")
    for cap in Capability:
        row = [cap.value]
        for name in sorted(router._providers):
            row.append("✓" if router.supports(name, cap) else "·")
        table.add_row(*row)
    console.print(table)


_CAPABILITY_OPTION = typer.Option(
    ..., "--capability", "-c", help="Required capability (repeatable)"
)


@app.command()
def route(
    capability: list[str] = _CAPABILITY_OPTION,
    mode: str = typer.Option("flexible", "--mode", help="strict | flexible"),
    current: str | None = typer.Option(
        None, "--current", help="Currently-bound provider (required for strict)"
    ),
    config_path: str | None = typer.Option(None, "--config"),
) -> None:
    """Pick a provider that supports the given capabilities."""
    from pathlib import Path

    if mode not in ("strict", "flexible"):
        console.print(f"[red]invalid --mode '{mode}' (use strict|flexible)[/red]")
        raise typer.Exit(code=2)

    try:
        required = [Capability(c) for c in capability]
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from None

    cap_config = CapabilityConfig.load_or_default(
        Path(config_path) if config_path else default_config_path()
    )
    router = CapabilityRouter(_instantiate_all_providers(), cap_config)

    try:
        decision = router.route(required, mode=mode, current=current)  # type: ignore[arg-type]
    except (NoMatchingProviderError, ValueError) as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=1) from None

    console.print(f"[green]→ {decision.provider}[/green]")
    if decision.fallback_from:
        console.print(f"[yellow]fallback from: {decision.fallback_from}[/yellow]")


@app.command()
def ask(
    prompt: str = typer.Argument(..., help="One-shot prompt to send"),
    provider: str = typer.Option("claude", "--provider", "-p"),
    model: str | None = typer.Option(None, "--model", "-m"),
    system: str | None = typer.Option(None, "--system", "-s"),
    max_tokens: int = typer.Option(1024, "--max-tokens"),
) -> None:
    """One-shot chat — proves the provider end-to-end."""
    prov, model_used = _make_provider(provider, model)

    async def run() -> None:
        response = await prov.chat(
            [Message(role=Role.USER, content=prompt)],
            system=system,
            max_tokens=max_tokens,
        )
        console.print(response.content)
        console.print(
            f"\n[dim]{response.provider} · {response.model} · "
            f"in {response.usage.input_tokens} / out {response.usage.output_tokens}[/dim]"
        )

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        raise typer.Exit(code=130) from None


@app.command()
def stream(
    prompt: str = typer.Argument(..., help="Prompt to stream a response for"),
    provider: str = typer.Option("claude", "--provider", "-p"),
    model: str | None = typer.Option(None, "--model", "-m"),
    system: str | None = typer.Option(None, "--system", "-s"),
    max_tokens: int = typer.Option(1024, "--max-tokens"),
) -> None:
    """Stream a chat response token-by-token."""
    prov, _ = _make_provider(provider, model)

    async def run() -> None:
        async for chunk in prov.stream(
            [Message(role=Role.USER, content=prompt)],
            system=system,
            max_tokens=max_tokens,
        ):
            console.print(chunk, end="")
        console.print()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        raise typer.Exit(code=130) from None


if __name__ == "__main__":
    app()
