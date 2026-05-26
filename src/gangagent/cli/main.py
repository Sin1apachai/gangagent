import asyncio

import typer
from rich.console import Console

from gangagent.config import load_settings
from gangagent.core import Message, Role
from gangagent.providers import ProviderConfig, ProviderRegistry

app = typer.Typer(
    name="gang",
    help="gangAgent — multi-provider AI agent orchestration.",
    no_args_is_help=True,
)
console = Console()


def _make_provider(provider_name: str, model: str | None):
    settings = load_settings()
    name = provider_name or settings.gang_default_provider
    selected_model = model or settings.gang_default_model

    api_key: str | None = None
    if name == "claude":
        api_key = settings.anthropic_api_key
        if not api_key:
            console.print(
                "[red]ANTHROPIC_API_KEY not set.[/red] "
                "Copy .env.example to .env and fill it in."
            )
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
