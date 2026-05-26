# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source of truth

`plan.md` (Thai) is the authoritative design document. Read it before making non-trivial changes — it spells out locked decisions (language/UI/provider order/license), architectural choices (Capability Flag, Strategy + Adapter + Registry, Hybrid Personality Engine), system agents (Mediator, Watcher), and the phased roadmap. Do not contradict locked decisions; propose options with trade-offs instead of choosing for the user.

## Commands

This project uses `uv` (not pip) and Python 3.12+.

```bash
uv sync                       # install/refresh deps from pyproject.toml + uv.lock
uv run pytest -q              # run all tests
uv run pytest tests/test_registry.py::test_discover_finds_claude   # single test
uv run ruff check .           # lint
uv run ruff format .          # format
uv run mypy src               # type-check (strict mode is on)
uv run gang providers         # list registered providers
uv run gang ask "..."         # one-shot chat (needs ANTHROPIC_API_KEY in .env)
```

`gang` is the entry point declared in `pyproject.toml` (`[project.scripts]`). Copy `.env.example` to `.env` for live calls.

## Architecture

Layered, provider-neutral. The CLI knows nothing about Anthropic/OpenAI/etc. — it only talks to `IAgentProvider`.

```
cli/main.py  ──▶  ProviderRegistry.create(name, config)  ──▶  IAgentProvider
                                                                   │
                                          @register_provider("claude")
                                              implementations/claude.py
```

Key conventions to preserve when extending:

- **Provider plug-in pattern.** Each provider lives in `src/gangagent/providers/implementations/<name>.py` and registers itself with `@register_provider("<name>")`. `ProviderRegistry.discover()` imports the package so decorators fire; **do not** hard-code provider names anywhere else. Adding a provider should not require edits outside its own file plus possibly capability flags.
- **Provider-neutral domain.** `core/message.py` defines `Message`, `Response`, `Role`, `Usage`. Providers must convert to/from their SDK formats internally (see `ClaudeProvider._to_anthropic_messages`). Never leak SDK-specific types past the provider boundary.
- **Capability flags, not lowest common denominator.** `Capability` (StrEnum in `capabilities/base.py`) is what callers check via `provider.supports(...)`. Branch on capability, not on provider name. Per `plan.md`, future capability config + router live here.
- **IAgentProvider is a `Protocol`** (structural typing). Implementations don't inherit from it; they just match the shape. Keep `chat()` async and accept `system: str | None` even though `Message` has a `SYSTEM` role — Anthropic takes `system` as a top-level field, and the adapter merges both.

## Things easy to get wrong

- The Anthropic SDK uses a top-level `system` parameter, not a system message. `ClaudeProvider._to_anthropic_messages` strips `Role.SYSTEM` out and returns it separately — keep this contract when touching that code.
- `uv.lock` is gitignored intentionally (project is pre-git). Don't add it back without a reason.
- `pyproject.toml` is configured with `mypy` strict and `ruff` selecting `E,F,I,B,UP,N,SIM`. `UP042` will reject `class X(str, Enum)` — use `StrEnum` instead.
- Tests should not make live API calls. `tests/test_registry.py` instantiates `ClaudeProvider` with a dummy key to check capability declarations without contacting the network — follow that pattern.

## Not yet implemented (per plan.md phases)

Phase 0 is done (scaffold + Claude + chat CLI). The following are designed but not built — check `plan.md` before starting:

- Phase 1: OpenAI/Gemini providers, `CapabilityRouter`, tool schema adapter, YAML capability config
- Phase 2: Agent lifecycle states, Personality Engine (hash + LLM + seed), naming/reveal UX
- Phase 3+: Skill/Role registry, Memory (short/long/structured), Mediator + Watcher system agents

When asked to "continue with the plan", confirm which phase/step before writing code — the plan is broad and the user prefers to pick.
