"""Light SQL migration runner — linear versioned, raw SQL files.

Per `plan.md` §Schema Migration: no Alembic, just sortable `NNNN_name.sql`
files with `-- up` / `-- down` sections. Each migration runs in its own
transaction; applied versions live in `schema_migrations` inside the same DB.

File format
-----------
    -- name: add_profession_label_to_agent
    -- version: 0003

    -- up
    ALTER TABLE agents ADD COLUMN created_from_profession TEXT;

    -- down
    ALTER TABLE agents DROP COLUMN created_from_profession;

Filenames are the source of truth for `version` (prefix before the first `_`);
the header `-- version:` is validated against the filename to catch typos.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

_TRACKING_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    checksum TEXT NOT NULL
)
"""

_FILENAME_RE = re.compile(r"^(?P<version>\d{4,})_(?P<name>[a-zA-Z0-9_\-]+)\.sql$")
_HEADER_RE = re.compile(
    r"^\s*--\s*(?P<key>name|version)\s*:\s*(?P<value>.+?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
_SECTION_RE = re.compile(
    r"^\s*--\s*(up|down)\s*$",
    re.IGNORECASE | re.MULTILINE,
)


class MigrationParseError(ValueError):
    """A migration file is malformed (missing section, version mismatch, ...)."""


class MigrationDriftError(RuntimeError):
    """A migration that's already applied has a different checksum on disk."""


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    up_sql: str
    down_sql: str
    path: Path
    checksum: str

    @classmethod
    def from_path(cls, path: Path) -> Migration:
        match = _FILENAME_RE.match(path.name)
        if not match:
            raise MigrationParseError(
                f"{path.name}: filename must be NNNN_snake_name.sql"
            )
        file_version = match.group("version")
        body = path.read_text()

        headers = {m.group("key").lower(): m.group("value") for m in _HEADER_RE.finditer(body)}
        header_name = headers.get("name", "").strip()
        header_version = headers.get("version", "").strip()
        if not header_name:
            raise MigrationParseError(f"{path.name}: missing `-- name:` header")
        if not header_version:
            raise MigrationParseError(f"{path.name}: missing `-- version:` header")
        if header_version != file_version:
            raise MigrationParseError(
                f"{path.name}: `-- version: {header_version}` does not match filename version {file_version}"
            )

        sections: dict[str, str] = {}
        markers = list(_SECTION_RE.finditer(body))
        if len(markers) < 2:
            raise MigrationParseError(
                f"{path.name}: must contain both `-- up` and `-- down` sections"
            )
        for i, m in enumerate(markers):
            section = m.group(1).lower()
            start = m.end()
            end = markers[i + 1].start() if i + 1 < len(markers) else len(body)
            sections[section] = body[start:end].strip()

        if "up" not in sections or not sections["up"]:
            raise MigrationParseError(f"{path.name}: empty or missing `-- up` section")
        if "down" not in sections or not sections["down"]:
            raise MigrationParseError(f"{path.name}: empty or missing `-- down` section")

        checksum = hashlib.sha256(body.encode("utf-8")).hexdigest()
        return cls(
            version=file_version,
            name=header_name,
            up_sql=sections["up"],
            down_sql=sections["down"],
            path=path,
            checksum=checksum,
        )


@dataclass(frozen=True)
class _AppliedRow:
    version: str
    name: str
    applied_at: str
    checksum: str


@dataclass(frozen=True)
class MigrationStatus:
    current: str | None
    applied: list[_AppliedRow]
    pending: list[Migration]
    drift: list[str]  # versions whose on-disk checksum differs from recorded


class MigrationRunner:
    def __init__(self, db_path: Path, migrations_dir: Path) -> None:
        self.db_path = db_path
        self.migrations_dir = migrations_dir

    # ---- discovery ------------------------------------------------------

    def discover(self) -> list[Migration]:
        if not self.migrations_dir.exists():
            return []
        migrations: list[Migration] = []
        for path in sorted(self.migrations_dir.glob("*.sql")):
            migrations.append(Migration.from_path(path))
        versions = [m.version for m in migrations]
        if len(versions) != len(set(versions)):
            dupes = sorted({v for v in versions if versions.count(v) > 1})
            raise MigrationParseError(f"duplicate migration versions: {dupes}")
        return migrations

    # ---- DB plumbing ----------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute(_TRACKING_TABLE_SQL)
        conn.commit()
        return conn

    def _fetch_applied(self, conn: sqlite3.Connection) -> list[_AppliedRow]:
        rows = conn.execute(
            "SELECT version, name, applied_at, checksum FROM schema_migrations ORDER BY version"
        ).fetchall()
        return [_AppliedRow(*row) for row in rows]

    # ---- status ---------------------------------------------------------

    def status(self) -> MigrationStatus:
        discovered = self.discover()
        by_version = {m.version: m for m in discovered}
        with closing(self._connect()) as conn:
            applied = self._fetch_applied(conn)

        applied_versions = {row.version for row in applied}
        drift = [
            row.version
            for row in applied
            if row.version in by_version and by_version[row.version].checksum != row.checksum
        ]
        pending = [m for m in discovered if m.version not in applied_versions]
        current = applied[-1].version if applied else None
        return MigrationStatus(
            current=current, applied=applied, pending=pending, drift=drift
        )

    # ---- migrate / rollback --------------------------------------------

    def migrate(self, *, to: str | None = None, dry_run: bool = False) -> list[Migration]:
        """Apply pending migrations up to (and including) `to`. Returns applied."""
        status = self.status()
        if status.drift:
            raise MigrationDriftError(
                f"refusing to migrate: drift on versions {status.drift}"
            )
        pending = status.pending
        if to is not None:
            pending = [m for m in pending if m.version <= to]

        if dry_run or not pending:
            return pending

        with closing(self._connect()) as conn:
            for m in pending:
                self._apply(conn, m)
        return pending

    def rollback(self, *, to: str | None = None, dry_run: bool = False) -> list[Migration]:
        """Roll back the most recent migration (default) or down to (but not including) `to`."""
        status = self.status()
        discovered_by_version = {m.version: m for m in self.discover()}
        applied = list(reversed(status.applied))
        if not applied:
            return []

        rollback_list: list[Migration]
        if to is None:
            row = applied[0]
            if row.version not in discovered_by_version:
                raise MigrationParseError(
                    f"cannot rollback {row.version}: source file missing"
                )
            rollback_list = [discovered_by_version[row.version]]
        else:
            rollback_list = []
            for row in applied:
                if row.version <= to:
                    break
                if row.version not in discovered_by_version:
                    raise MigrationParseError(
                        f"cannot rollback {row.version}: source file missing"
                    )
                rollback_list.append(discovered_by_version[row.version])

        if dry_run or not rollback_list:
            return rollback_list

        with closing(self._connect()) as conn:
            for m in rollback_list:
                self._unapply(conn, m)
        return rollback_list

    # ---- apply/unapply --------------------------------------------------

    def _apply(self, conn: sqlite3.Connection, m: Migration) -> None:
        try:
            with conn:  # transaction
                conn.executescript(m.up_sql)
                conn.execute(
                    "INSERT INTO schema_migrations (version, name, applied_at, checksum)"
                    " VALUES (?, ?, ?, ?)",
                    (m.version, m.name, datetime.now(UTC).isoformat(), m.checksum),
                )
        except sqlite3.Error as e:
            raise RuntimeError(f"migration {m.version} failed on up: {e}") from e

    def _unapply(self, conn: sqlite3.Connection, m: Migration) -> None:
        try:
            with conn:
                conn.executescript(m.down_sql)
                conn.execute(
                    "DELETE FROM schema_migrations WHERE version = ?", (m.version,)
                )
        except sqlite3.Error as e:
            raise RuntimeError(f"migration {m.version} failed on down: {e}") from e

    # ---- scaffolding ----------------------------------------------------

    def scaffold(self, name: str) -> Path:
        """Create a new empty migration file with the next sequential version."""
        existing = sorted(self.migrations_dir.glob("*.sql")) if self.migrations_dir.exists() else []
        if existing:
            last = _FILENAME_RE.match(existing[-1].name)
            next_version = f"{int(last.group('version')) + 1:04d}" if last else "0001"
        else:
            next_version = "0001"

        slug = re.sub(r"[^a-zA-Z0-9]+", "_", name).strip("_").lower() or "migration"
        path = self.migrations_dir / f"{next_version}_{slug}.sql"
        self.migrations_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(
            f"-- name: {slug}\n-- version: {next_version}\n\n-- up\n\n\n-- down\n\n"
        )
        return path


# ---- defaults -----------------------------------------------------------


def default_db_path() -> Path:
    return Path.cwd() / "data" / "sqlite" / "gangagent.db"


def default_migrations_dir() -> Path:
    return Path(__file__).parent
