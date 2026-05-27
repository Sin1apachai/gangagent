"""Convert provider-neutral `Tool` objects to each vendor's wire format.

Adapters return JSON-serializable dicts so providers can pass them straight to
their SDK (`tools=[...]`). Doing the conversion in one place keeps providers
free of cross-vendor knowledge — and is what Phase 3 Skill registry + MCP
bridge will plug into.
"""

from collections.abc import Callable, Iterable
from typing import Any

from gangagent.tools.schema import Tool


def to_anthropic(tool: Tool) -> dict[str, Any]:
    """Anthropic format: identical to our internal schema."""
    return {
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.input_schema,
    }


def to_openai(tool: Tool) -> dict[str, Any]:
    """OpenAI chat-completions function-tool format."""
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.input_schema,
        },
    }


def to_gemini(tool: Tool) -> dict[str, Any]:
    """Gemini function-declaration format.

    Returned as a dict — `google-genai` accepts dicts and converts to
    `types.FunctionDeclaration` internally. We rename `input_schema` to
    `parameters` to match Gemini's field.
    """
    return {
        "name": tool.name,
        "description": tool.description,
        "parameters": tool.input_schema,
    }


def _bundle_claude(tools: list[Tool]) -> list[dict[str, Any]]:
    return [to_anthropic(t) for t in tools]


def _bundle_openai(tools: list[Tool]) -> list[dict[str, Any]]:
    return [to_openai(t) for t in tools]


def _bundle_gemini(tools: list[Tool]) -> list[dict[str, Any]]:
    # Gemini wraps function declarations in a single `Tool` envelope.
    return [{"function_declarations": [to_gemini(t) for t in tools]}]


_BUNDLERS: dict[str, Callable[[list[Tool]], list[dict[str, Any]]]] = {
    "claude": _bundle_claude,
    "openai": _bundle_openai,
    "gemini": _bundle_gemini,
}


def bundle_for(provider: str, tools: Iterable[Tool]) -> list[dict[str, Any]]:
    """Convert a list of tools into the shape `tools=[...]` for the given provider.

    Raises `KeyError` for unknown providers — keeps misuse loud.
    """
    if provider not in _BUNDLERS:
        raise KeyError(
            f"Unknown provider '{provider}' for tool bundling. "
            f"Available: {sorted(_BUNDLERS)}"
        )
    return _BUNDLERS[provider](list(tools))
