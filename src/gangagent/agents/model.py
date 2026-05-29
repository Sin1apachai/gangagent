"""Provider-neutral Agent record. Mirrors the `agents` table 1:1."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime

from gangagent.agents.state import AgentState


@dataclass(frozen=True, slots=True)
class Agent:
    id: str
    name: str
    provider: str
    model: str
    state: AgentState
    created_at: datetime
    updated_at: datetime

    def with_state(self, state: AgentState, *, at: datetime) -> Agent:
        return replace(self, state=state, updated_at=at)
