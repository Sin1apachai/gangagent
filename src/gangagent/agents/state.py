"""Agent lifecycle states + transition rules.

Per `plan.md` §3 Agent Lifecycle. The state machine is intentionally narrow:
each agent walks a forward path from `Spawning` through `Active`, and from
`Active` can be parked in `Sleeping` (memory kept) or terminated to `Retired`.

`Profession` from the plan is an optional step folded into Phase 3 and is
*not* a lifecycle state here — applying a Profession Template mutates
role/skills/traits but the agent stays in whatever lifecycle state it was in.
"""

from __future__ import annotations

from enum import StrEnum


class AgentState(StrEnum):
    SPAWNING = "spawning"
    NAMING = "naming"
    FORMING = "forming"
    TRAINING = "training"
    ACTIVE = "active"
    SLEEPING = "sleeping"
    RETIRED = "retired"


# Forward graph. `Retired` is terminal (no outgoing edges).
VALID_TRANSITIONS: dict[AgentState, frozenset[AgentState]] = {
    AgentState.SPAWNING: frozenset({AgentState.NAMING}),
    AgentState.NAMING: frozenset({AgentState.FORMING}),
    AgentState.FORMING: frozenset({AgentState.TRAINING}),
    AgentState.TRAINING: frozenset({AgentState.ACTIVE}),
    AgentState.ACTIVE: frozenset({AgentState.SLEEPING, AgentState.RETIRED}),
    AgentState.SLEEPING: frozenset({AgentState.ACTIVE, AgentState.RETIRED}),
    AgentState.RETIRED: frozenset(),
}


class InvalidTransitionError(ValueError):
    """Raised when a state transition is not permitted by the lifecycle graph."""


def can_transition(from_: AgentState, to: AgentState) -> bool:
    return to in VALID_TRANSITIONS[from_]


def assert_transition(from_: AgentState, to: AgentState) -> None:
    if not can_transition(from_, to):
        raise InvalidTransitionError(f"cannot transition {from_.value} → {to.value}")
