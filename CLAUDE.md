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

# Chat
uv run gang providers                 # list registered providers
uv run gang ask "..." -p claude       # one-shot chat (needs *_API_KEY in .env)
uv run gang stream "..." -p openai

# Capabilities (Phase 1)
uv run gang capabilities              # provider × capability matrix
uv run gang route -c vision -c tool_use --mode flexible --current claude

# Schema migrations (Phase 1)
uv run gang db status
uv run gang db migrate [--to NNNN] [--dry-run]
uv run gang db rollback [--to NNNN]
uv run gang db new <snake_name>

# MCP (Phase 1)
uv run gang mcp list                  # configured servers
uv run gang mcp tools                 # discover tools across enabled servers
uv run gang mcp test <server>         # spawn one server + list its tools
GANG_LIVE_MCP=1 uv run pytest tests/test_mcp.py::test_live_filesystem_server  # DoD gate
```

`gang` is the entry point declared in `pyproject.toml` (`[project.scripts]`). Copy `.env.example` to `.env` for live calls.

## Architecture

Layered, provider-neutral. The CLI knows nothing about Anthropic/OpenAI/etc. — it only talks to `IAgentProvider`.

```
cli/main.py  ──▶  ProviderRegistry.create(name, config)  ──▶  IAgentProvider
                                                                   │
                                          @register_provider("claude" | "openai" | "gemini")
                                              implementations/<name>.py

CapabilityRouter ──▶ picks provider that supports a required Capability set
                     (strict | flexible mode; reads data/configs/capabilities.yaml)

tools.Tool ──▶ tools/adapters.py {to_anthropic, to_openai, to_gemini, bundle_for}
                     ▲
                MCP bridge: mcp.types.Tool → tools.Tool (one path, three vendors)

migrations.MigrationRunner ──▶ linear SQL files in src/gangagent/migrations/NNNN_*.sql
                               (tracking table `schema_migrations`, checksum drift detection)
```

Key conventions to preserve when extending:

- **Provider plug-in pattern.** Each provider lives in `src/gangagent/providers/implementations/<name>.py` and registers itself with `@register_provider("<name>")`. `ProviderRegistry.discover()` imports the package so decorators fire; **do not** hard-code provider names anywhere else. Adding a provider should not require edits outside its own file plus possibly capability flags.
- **Provider-neutral domain.** `core/message.py` defines `Message`, `Response`, `Role`, `Usage`. Providers must convert to/from their SDK formats internally (see `ClaudeProvider._to_anthropic_messages`). Never leak SDK-specific types past the provider boundary.
- **Capability flags, not lowest common denominator.** `Capability` (StrEnum in `capabilities/base.py`) is what callers check via `provider.supports(...)`. Branch on capability, not on provider name. The `CapabilityRouter` (`capabilities/router.py`) consults `data/configs/capabilities.yaml` — declare new vendor features there via `extra_supports` instead of editing provider code.
- **IAgentProvider is a `Protocol`** (structural typing). Implementations don't inherit from it; they just match the shape. Keep `chat()` async and accept `system: str | None` even though `Message` has a `SYSTEM` role — Anthropic takes `system` as a top-level field, and the adapter merges both. Gemini also has a separate `system_instruction`; OpenAI prepends a system message.
- **One tool schema, three wire formats.** Define tools as `tools.Tool` (Anthropic-shaped) and emit per-vendor via `tools.bundle_for(provider, tools)`. MCP tools enter through `mcp.bridge.mcp_tool_to_tool` and reuse the same adapters — no second converter.
- **Config in `data/configs/`, validated by Pydantic.** Every YAML config (`capabilities.yaml`, `mcp_servers.yaml`, …) loads through a Pydantic model. `${ENV_VAR}` interpolation is loud-fail — a missing env var raises, never silently becomes `""`.

## Things easy to get wrong

- The Anthropic SDK uses a top-level `system` parameter, not a system message. `ClaudeProvider._to_anthropic_messages` strips `Role.SYSTEM` out and returns it separately — keep this contract when touching that code. Gemini behaves similarly (separate `config.system_instruction`); OpenAI prepends a `system` role to the message list.
- Gemini renames `ASSISTANT` → `"model"` and accepts JSON-Schema tool params under `parameters`, not `input_schema`. The conversion lives only in `providers/implementations/gemini.py` and `tools/adapters.py:to_gemini` — keep it confined.
- `data/` is gitignored. Template configs (`*.example.yaml`) live in `data/configs/` for the user to copy — the example files themselves are also gitignored today, so when adding a new config family ship its example via README/plan.md rather than expecting it in the repo.
- Migration files are the source of truth for their version: the `NNNN` prefix in the filename must match the `-- version:` header. `MigrationRunner` rejects mismatches loudly.
- `uv.lock` is gitignored intentionally (project is pre-git). Don't add it back without a reason.
- `pyproject.toml` is configured with `mypy` strict and `ruff` selecting `E,F,I,B,UP,N,SIM`. `UP042` will reject `class X(str, Enum)` — use `StrEnum` instead. `B008` fires on `list[str] = typer.Option(...)` defaults — extract the option into a module-level constant.
- Tests should not make live API calls. `tests/test_registry.py` instantiates providers with dummy keys to check capability declarations without contacting the network — follow that pattern. Live tests (e.g. real MCP filesystem server) are gated behind an opt-in env var like `GANG_LIVE_MCP=1`.

## Not yet implemented (per plan.md phases)

Phase 0 + Phase 1 are done (scaffold + 3 providers + capability router + tool adapter + MCP + migrations). The following are designed but not built — check `plan.md` before starting:

- Phase 2: Agent lifecycle states, Personality Engine (hash + LLM + seed), naming/reveal UX, Prompt Library + versioning
- Phase 3: Skill/Role registry, Memory (short/long/structured), RAG pipeline, Backup (restic), Profession Template
- Phase 4: Notification system (Telegram/Discord/Line/Email), Scheduled tasks
- Phase 5+: Mediator + Watcher system agents, Guardrails, Observability/Eval

When asked to "continue with the plan", confirm which phase/step before writing code — the plan is broad and the user prefers to pick.
