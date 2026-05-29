"""SQLite-backed registry for `Agent` records.

Shares its DB file with `MigrationRunner` (`data/sqlite/gangagent.db` by
default). The repository assumes the schema is already migrated — callers
should run `gang db migrate` first.
"""

from __future__ import annotations

import sqlite3
import uuid
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from gangagent.agents.model import Agent
from gangagent.agents.state import AgentState, assert_transition
from gangagent.migrations import default_db_path


class AgentNotFoundError(LookupError):
    """No agent in the registry has the given id."""


def _now() -> datetime:
    return datetime.now(UTC)


def _row_to_agent(row: sqlite3.Row) -> Agent:
    return Agent(
        id=row["id"],
        name=row["name"],
        provider=row["provider"],
        model=row["model"],
        state=AgentState(row["state"]),
        created_at=datetime.fromisoformat(row["created_at"]),
        updated_at=datetime.fromisoformat(row["updated_at"]),
    )


class AgentRepository:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or default_db_path()

    def _connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    # ---- writes ---------------------------------------------------------

    def create(
        self,
        *,
        name: str,
        provider: str,
        model: str,
        state: AgentState = AgentState.SPAWNING,
        id: str | None = None,
        now: datetime | None = None,
    ) -> Agent:
        agent_id = id or uuid.uuid4().hex
        ts = (now or _now()).isoformat()
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO agents (id, name, provider, model, state, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (agent_id, name, provider, model, state.value, ts, ts),
            )
        got = self.get(agent_id)
        assert got is not None  # we just inserted it
        return got

    def transition(self, agent_id: str, to: AgentState, *, now: datetime | None = None) -> Agent:
        agent = self.get(agent_id)
        if agent is None:
            raise AgentNotFoundError(agent_id)
        assert_transition(agent.state, to)
        ts = (now or _now()).isoformat()
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "UPDATE agents SET state = ?, updated_at = ? WHERE id = ?",
                (to.value, ts, agent_id),
            )
        return agent.with_state(to, at=datetime.fromisoformat(ts))

    def delete(self, agent_id: str) -> None:
        with closing(self._connect()) as conn, conn:
            cur = conn.execute("DELETE FROM agents WHERE id = ?", (agent_id,))
            if cur.rowcount == 0:
                raise AgentNotFoundError(agent_id)

    # ---- reads ----------------------------------------------------------

    def get(self, agent_id: str) -> Agent | None:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT * FROM agents WHERE id = ?", (agent_id,)).fetchone()
        return _row_to_agent(row) if row else None

    def list(
        self,
        *,
        state: AgentState | None = None,
        include_retired: bool = False,
    ) -> list[Agent]:
        sql = "SELECT * FROM agents"
        params: list[str] = []
        clauses: list[str] = []
        if state is not None:
            clauses.append("state = ?")
            params.append(state.value)
        elif not include_retired:
            clauses.append("state != ?")
            params.append(AgentState.RETIRED.value)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY created_at ASC"
        with closing(self._connect()) as conn:
            rows = conn.execute(sql, params).fetchall()
        return [_row_to_agent(r) for r in rows]
