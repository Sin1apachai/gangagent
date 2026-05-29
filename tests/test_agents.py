"""Tests for the Agent registry + lifecycle.

Each test gets a fresh SQLite DB under `tmp_path` and runs every bundled
migration first, so the schema mirrors what real users see after
`gang db migrate`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from gangagent.agents import (
    Agent,
    AgentNotFoundError,
    AgentRepository,
    AgentState,
    InvalidTransitionError,
    can_transition,
)
from gangagent.migrations import MigrationRunner, default_migrations_dir


@pytest.fixture
def repo(tmp_path: Path) -> AgentRepository:
    db = tmp_path / "agents.db"
    MigrationRunner(db_path=db, migrations_dir=default_migrations_dir()).migrate()
    return AgentRepository(db_path=db)


# ---- state machine -----------------------------------------------------


def test_forward_path_is_allowed() -> None:
    chain = [
        AgentState.SPAWNING,
        AgentState.NAMING,
        AgentState.FORMING,
        AgentState.TRAINING,
        AgentState.ACTIVE,
    ]
    for a, b in zip(chain, chain[1:], strict=False):
        assert can_transition(a, b), f"{a} → {b} should be allowed"


def test_active_can_sleep_and_wake() -> None:
    assert can_transition(AgentState.ACTIVE, AgentState.SLEEPING)
    assert can_transition(AgentState.SLEEPING, AgentState.ACTIVE)


def test_retired_is_terminal() -> None:
    for s in AgentState:
        assert not can_transition(AgentState.RETIRED, s), f"retired → {s} must be blocked"


def test_cannot_skip_states() -> None:
    assert not can_transition(AgentState.SPAWNING, AgentState.ACTIVE)
    assert not can_transition(AgentState.NAMING, AgentState.TRAINING)


# ---- repository --------------------------------------------------------


def test_create_and_get_roundtrip(repo: AgentRepository) -> None:
    a = repo.create(name="Aria", provider="claude", model="claude-haiku-4-5-20251001")
    got = repo.get(a.id)
    assert got == a
    assert got is not None
    assert got.state is AgentState.SPAWNING
    assert got.created_at == got.updated_at


def test_get_returns_none_for_unknown(repo: AgentRepository) -> None:
    assert repo.get("does-not-exist") is None


def test_transition_updates_state_and_timestamp(repo: AgentRepository) -> None:
    t0 = datetime(2026, 5, 29, 12, 0, 0, tzinfo=UTC)
    a = repo.create(name="Bob", provider="openai", model="gpt-4o", now=t0)
    t1 = t0 + timedelta(seconds=42)
    moved = repo.transition(a.id, AgentState.NAMING, now=t1)
    assert moved.state is AgentState.NAMING
    assert moved.updated_at == t1
    assert moved.created_at == t0
    assert repo.get(a.id) == moved


def test_invalid_transition_raises(repo: AgentRepository) -> None:
    a = repo.create(name="C", provider="gemini", model="gemini-2.0-flash")
    with pytest.raises(InvalidTransitionError):
        repo.transition(a.id, AgentState.ACTIVE)


def test_transition_unknown_agent(repo: AgentRepository) -> None:
    with pytest.raises(AgentNotFoundError):
        repo.transition("nope", AgentState.NAMING)


def _advance_to(repo: AgentRepository, agent: Agent, target: AgentState) -> Agent:
    path = [
        AgentState.SPAWNING,
        AgentState.NAMING,
        AgentState.FORMING,
        AgentState.TRAINING,
        AgentState.ACTIVE,
    ]
    current = agent
    for s in path[path.index(agent.state) + 1 :]:
        current = repo.transition(current.id, s)
        if current.state is target:
            return current
    return current


def test_list_hides_retired_by_default(repo: AgentRepository) -> None:
    keep = repo.create(name="Live", provider="claude", model="m")
    gone = repo.create(name="Gone", provider="claude", model="m")
    gone = _advance_to(repo, gone, AgentState.ACTIVE)
    repo.transition(gone.id, AgentState.RETIRED)

    visible = repo.list()
    assert {a.id for a in visible} == {keep.id}

    all_ = repo.list(include_retired=True)
    assert {a.id for a in all_} == {keep.id, gone.id}


def test_list_state_filter(repo: AgentRepository) -> None:
    a = repo.create(name="A", provider="claude", model="m")
    b = repo.create(name="B", provider="claude", model="m")
    repo.transition(b.id, AgentState.NAMING)

    spawning = repo.list(state=AgentState.SPAWNING)
    assert [x.id for x in spawning] == [a.id]
    naming = repo.list(state=AgentState.NAMING)
    assert [x.id for x in naming] == [b.id]


def test_retired_round_trip(repo: AgentRepository) -> None:
    a = repo.create(name="R", provider="claude", model="m")
    a = _advance_to(repo, a, AgentState.ACTIVE)
    repo.transition(a.id, AgentState.RETIRED)
    with pytest.raises(InvalidTransitionError):
        repo.transition(a.id, AgentState.ACTIVE)


def test_delete_removes_row(repo: AgentRepository) -> None:
    a = repo.create(name="Drop", provider="claude", model="m")
    repo.delete(a.id)
    assert repo.get(a.id) is None
    with pytest.raises(AgentNotFoundError):
        repo.delete(a.id)
