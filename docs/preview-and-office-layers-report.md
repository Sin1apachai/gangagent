# Artifact preview and office layers

Implemented 2026-11-02. No database migration or new persistent host helper is required.

## Changes

Authenticated artifact requests accept `?preview=true`. Text is returned in a JSON envelope and rendered through React text nodes. Basic Markdown headings, lists, tables and code blocks are supported; arbitrary HTML, scripts and remote embeds are not executed. Raster image responses use fixed MIME types, `nosniff` and a restrictive CSP. Download behavior is unchanged. Text preview is limited to 512 KiB; images retain the existing 10 MiB limit. PDF/Office/binary documents remain downloads. An attempt to loosen iframe script/same-origin restrictions was rejected by automatic approval review; that approach was discarded and no iframe preview remains.

The canvas derives levels from kind: rug=1, floor furniture=2, computer=3. Same-level collisions remain invalid. Computers may overlap desks/meeting tables, while floor-standing legacy computers remain accepted. Backend and frontend agree on overlap rules. Hit testing prioritizes the top layer and the editor can select a specific layer. Moving a desk carries computers currently on it; prospective bounds and collisions are checked before any change. Level information stays in the existing kind-based layout representation.

Character activity chooses reachable adjacent cells within the assigned room/common area. Running tasks take precedence over another task awaiting review. Working agents prefer computers, then desks/meeting tables; idle agents may visit coffee/books/plants. Targets are cached per activity period rather than running pathfinding every animation frame. Existing reduced-motion behavior is retained. These are visual status cues, not claims that provider tools executed commands.

## Verification

- Docker Compose full integration run: 91 HTTP tests passed, including text preview authorization/download preservation and layer round-trip/collision rejection.
- Final isolated feature suite: 3 HTTP tests passed, including raster MIME/headers, HTML delivered as non-executable JSON text, and unsupported binary rejection. One additional case beyond the full run makes 92 distinct HTTP cases covered across the runs.
- Docker build: 32 Rust tests passed. Final frontend build/test: 26 tests, including layering/hit priority, collision restrictions, reachable interaction goals, idle behavior, running-task priority and completed-task behavior.
- Browser in an isolated fixture workspace opened a Markdown artifact without a download and displayed its headings, table and code block. Closing returned to the task review screen.
- Browser selected floor furniture beneath a computer using layer 2, moved the desk through keyboard controls, and saved the layered layout successfully. Fixture animation displayed the character travelling to the workstation.
- Tests used fixture workers with explicit test opt-in, `office_test`, no Codex/Claude authentication volumes and no real provider inference.
- Production was backed up before deployment, with no active model job interrupted. Fingerprints of ten checked domain tables matched across deployment. Actual workspace layouts and jobs were not replaced with test fixtures.

Screenshots are fixture examples: [file preview](images/artifact-preview.jpg), [layered workstation](images/furniture-layers-interaction.jpg).
