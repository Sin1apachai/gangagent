"""Contract tests: Tool → claude/openai/gemini wire format.

Two example tools (get_weather, calculator) round-trip through each adapter.
The adapter outputs are checked structurally; we don't hit any SDK.
"""

import pytest

from gangagent.tools import (
    Tool,
    bundle_for,
    to_anthropic,
    to_gemini,
    to_openai,
)

WEATHER = Tool(
    name="get_weather",
    description="Get current weather for a city.",
    input_schema={
        "type": "object",
        "properties": {
            "city": {"type": "string", "description": "City name"},
            "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
        },
        "required": ["city"],
    },
)

CALCULATOR = Tool(
    name="calculator",
    description="Evaluate an arithmetic expression.",
    input_schema={
        "type": "object",
        "properties": {"expression": {"type": "string"}},
        "required": ["expression"],
    },
)


def test_to_anthropic_is_passthrough_shape() -> None:
    out = to_anthropic(WEATHER)
    assert out == {
        "name": "get_weather",
        "description": "Get current weather for a city.",
        "input_schema": WEATHER.input_schema,
    }


def test_to_openai_wraps_as_function_tool() -> None:
    out = to_openai(WEATHER)
    assert out["type"] == "function"
    fn = out["function"]
    assert fn["name"] == "get_weather"
    assert fn["description"] == WEATHER.description
    assert fn["parameters"] == WEATHER.input_schema
    # OpenAI must not carry the Anthropic `input_schema` key.
    assert "input_schema" not in fn


def test_to_gemini_renames_to_parameters() -> None:
    out = to_gemini(CALCULATOR)
    assert out == {
        "name": "calculator",
        "description": CALCULATOR.description,
        "parameters": CALCULATOR.input_schema,
    }
    assert "input_schema" not in out


def test_bundle_for_claude_emits_flat_list() -> None:
    bundle = bundle_for("claude", [WEATHER, CALCULATOR])
    assert [t["name"] for t in bundle] == ["get_weather", "calculator"]
    assert all("input_schema" in t for t in bundle)


def test_bundle_for_openai_emits_function_envelopes() -> None:
    bundle = bundle_for("openai", [WEATHER, CALCULATOR])
    assert all(t["type"] == "function" for t in bundle)
    assert [t["function"]["name"] for t in bundle] == ["get_weather", "calculator"]


def test_bundle_for_gemini_wraps_in_function_declarations() -> None:
    bundle = bundle_for("gemini", [WEATHER, CALCULATOR])
    # Gemini expects a list of Tool envelopes, each holding function_declarations.
    assert len(bundle) == 1
    declarations = bundle[0]["function_declarations"]
    assert [d["name"] for d in declarations] == ["get_weather", "calculator"]
    assert all("parameters" in d for d in declarations)


def test_bundle_for_unknown_provider_raises() -> None:
    with pytest.raises(KeyError):
        bundle_for("does-not-exist", [WEATHER])


def test_tool_default_input_schema_is_empty_object() -> None:
    bare = Tool(name="ping", description="ping")
    assert bare.input_schema == {"type": "object", "properties": {}}
    # Bare tools should still bundle cleanly for every vendor.
    for provider in ("claude", "openai", "gemini"):
        bundle_for(provider, [bare])
