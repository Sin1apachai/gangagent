"""Tests for the schema migration runner.

Covers parsing, up/down round-trip, drift detection, rollback targets, and
scaffolding. All file IO uses tmp_path; the bundled `0001_initial.sql` is
also exercised through `default_migrations_dir`.
"""

import sqlite3
from pathlib import Path

import pytest

from gangagent.migrations import (
    Migration,
    MigrationDriftError,
    MigrationParseError,
    MigrationRunner,
    default_migrations_dir,
)


def _write(dir: Path, version: str, name: str, up: str, down: str) -> Path:
    path = dir / f"{version}_{name}.sql"
    path.write_text(
        f"-- name: {name}\n-- version: {version}\n\n-- up\n{up}\n\n-- down\n{down}\n"
    )
    return path


@pytest.fixture
def runner(tmp_path: Path) -> MigrationRunner:
    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()
    return MigrationRunner(db_path=tmp_path / "test.db", migrations_dir=migrations_dir)


def test_parse_valid_file(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "0001",
        "initial",
        "CREATE TABLE t (id INTEGER);",
        "DROP TABLE t;",
    )
    m = Migration.from_path(path)
    assert m.version == "0001"
    assert m.name == "initial"
    assert "CREATE TABLE" in m.up_sql
    assert "DROP TABLE" in m.down_sql
    assert len(m.checksum) == 64


def test_parse_rejects_filename_version_mismatch(tmp_path: Path) -> None:
    path = tmp_path / "0002_foo.sql"
    path.write_text("-- name: foo\n-- version: 0099\n\n-- up\nSELECT 1;\n-- down\nSELECT 1;\n")
    with pytest.raises(MigrationParseError, match="does not match"):
        Migration.from_path(path)


def test_parse_rejects_missing_section(tmp_path: Path) -> None:
    path = tmp_path / "0001_bad.sql"
    path.write_text("-- name: bad\n-- version: 0001\n\n-- up\nSELECT 1;\n")
    with pytest.raises(MigrationParseError, match="both"):
        Migration.from_path(path)


def test_status_starts_empty(runner: MigrationRunner) -> None:
    _write(runner.migrations_dir, "0001", "init", "CREATE TABLE t(id INT);", "DROP TABLE t;")
    st = runner.status()
    assert st.current is None
    assert len(st.pending) == 1
    assert st.drift == []


def test_migrate_then_rollback_roundtrip(runner: MigrationRunner) -> None:
    _write(runner.migrations_dir, "0001", "init", "CREATE TABLE t(id INT);", "DROP TABLE t;")
    _write(
        runner.migrations_dir,
        "0002",
        "add_col",
        "ALTER TABLE t ADD COLUMN name TEXT;",
        "ALTER TABLE t DROP COLUMN name;",
    )

    applied = runner.migrate()
    assert [m.version for m in applied] == ["0001", "0002"]

    # The table exists and has both columns.
    with sqlite3.connect(runner.db_path) as conn:
        cols = [row[1] for row in conn.execute("PRAGMA table_info(t)")]
    assert set(cols) == {"id", "name"}

    rolled = runner.rollback()  # one step
    assert [m.version for m in rolled] == ["0002"]

    # Roll back the remaining migration.
    rolled2 = runner.rollback()
    assert [m.version for m in rolled2] == ["0001"]
    with sqlite3.connect(runner.db_path) as conn:
        tables = [
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        ]
    assert "t" not in tables
    # tracking table remains
    assert "schema_migrations" in tables


def test_migrate_to_specific_version(runner: MigrationRunner) -> None:
    _write(runner.migrations_dir, "0001", "a", "CREATE TABLE a(id INT);", "DROP TABLE a;")
    _write(runner.migrations_dir, "0002", "b", "CREATE TABLE b(id INT);", "DROP TABLE b;")
    _write(runner.migrations_dir, "0003", "c", "CREATE TABLE c(id INT);", "DROP TABLE c;")

    applied = runner.migrate(to="0002")
    assert [m.version for m in applied] == ["0001", "0002"]
    assert runner.status().current == "0002"


def test_rollback_to_specific_version(runner: MigrationRunner) -> None:
    _write(runner.migrations_dir, "0001", "a", "CREATE TABLE a(id INT);", "DROP TABLE a;")
    _write(runner.migrations_dir, "0002", "b", "CREATE TABLE b(id INT);", "DROP TABLE b;")
    _write(runner.migrations_dir, "0003", "c", "CREATE TABLE c(id INT);", "DROP TABLE c;")
    runner.migrate()

    # Roll back to (but not including) 0001 → unwinds 0003, 0002.
    rolled = runner.rollback(to="0001")
    assert [m.version for m in rolled] == ["0003", "0002"]
    assert runner.status().current == "0001"


def test_drift_blocks_migrate(runner: MigrationRunner) -> None:
    path = _write(
        runner.migrations_dir, "0001", "init", "CREATE TABLE t(id INT);", "DROP TABLE t;"
    )
    _write(runner.migrations_dir, "0002", "next", "CREATE TABLE u(id INT);", "DROP TABLE u;")
    runner.migrate(to="0001")

    # Edit applied file → checksum drift.
    path.write_text(
        "-- name: init\n-- version: 0001\n\n-- up\nCREATE TABLE t(id INT, x TEXT);\n\n-- down\nDROP TABLE t;\n"
    )
    st = runner.status()
    assert "0001" in st.drift

    with pytest.raises(MigrationDriftError):
        runner.migrate()


def test_dry_run_does_not_apply(runner: MigrationRunner) -> None:
    _write(runner.migrations_dir, "0001", "init", "CREATE TABLE t(id INT);", "DROP TABLE t;")
    pending = runner.migrate(dry_run=True)
    assert [m.version for m in pending] == ["0001"]
    assert runner.status().current is None  # nothing actually applied


def test_scaffold_increments_version(runner: MigrationRunner) -> None:
    _write(runner.migrations_dir, "0001", "init", "CREATE TABLE t(id INT);", "DROP TABLE t;")
    path = runner.scaffold("add columns")
    assert path.name == "0002_add_columns.sql"
    body = path.read_text()
    assert "-- version: 0002" in body
    assert "-- up" in body and "-- down" in body


def test_duplicate_versions_raise(runner: MigrationRunner) -> None:
    _write(runner.migrations_dir, "0001", "a", "CREATE TABLE a(id INT);", "DROP TABLE a;")
    # Same version, different name → still duplicate version.
    _write(runner.migrations_dir, "0001", "b", "CREATE TABLE b(id INT);", "DROP TABLE b;")
    with pytest.raises(MigrationParseError, match="duplicate"):
        runner.discover()


def test_bundled_initial_migration_roundtrips(tmp_path: Path) -> None:
    """The 0001_initial.sql we ship must round-trip cleanly — this is the Phase 1 DoD gate."""
    runner = MigrationRunner(db_path=tmp_path / "live.db", migrations_dir=default_migrations_dir())
    runner.migrate()
    with sqlite3.connect(runner.db_path) as conn:
        tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    assert "agents" in tables

    runner.rollback()
    with sqlite3.connect(runner.db_path) as conn:
        tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    assert "agents" not in tables
