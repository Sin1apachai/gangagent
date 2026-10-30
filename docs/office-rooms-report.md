# Multi-room office verification

Verified on 2026-10-30 using Docker Compose and the real browser.

## Behavior

Room boundaries, one door per room, names, purpose and department bindings are stored in the workspace layout JSON alongside furniture. Existing layouts deserialize with an empty room list; no seed workspace or schema migration is needed. The existing optimistic layout version and workspace write authorization apply to the entire edit.

Rooms are rectangular, at least 3 × 3 tiles on the existing 20 × 12 map, with a one-tile corridor between rooms. Doors must open inside the map. Validation on both server and client rejects overlapping rooms, invalid geometry, repeated room IDs or department assignments, furniture crossing boundaries and furniture covering either side of a door. Deleting a room preserves furniture and agents.

Department matching follows the existing Org Chart department names, ignoring surrounding whitespace and case. A department has one home room; shared rooms have no department. Assigned characters choose goals in their department room; unmatched characters use the common area. Pathfinding prevents crossing room boundaries except at the designated door. This is spatial organization, not a new authorization or workflow boundary.

## Verification evidence

- Full isolated Compose suite: 84 HTTP tests passed, including four new room tests covering create/edit/delete, optimistic conflicts, validation atomicity, rotated furniture, legacy layouts, workspace isolation and viewer permissions.
- Final application image: 29 Rust unit tests and 7 browser-domain/rendering tests passed. The four room HTTP tests passed again directly against the final image.
- Pathfinding tests prove a route leaves a room through its designated door and never crosses a solid boundary.
- An isolated preview with three rooms and three agents preserved its layout after restarting the application.
- Actual browser: furniture/room tabs, invalid overlap feedback, room edit/apply/save, reload persistence and correct per-department agent counts verified. No browser console errors or horizontal page overflow were observed at the tested viewport.
- No AI inference was needed. Production workspace data was not populated with acceptance fixtures.

Machine-readable persistence evidence: [office-rooms-proof.json](measurements/office-rooms-proof.json).

![Three-room preview after saving and reloading](images/office-rooms.jpg)

## Limitations

This release supports rectangular rooms with a single door and form-based placement/resizing, not free-form polygons, multiple floors or draggable wall segments. It does not alter AI task execution, room-based permissions, or infer physical meetings from workflows. Room editing requires applying the room draft and then saving the office; cancelling the office edit restores the saved layout.
