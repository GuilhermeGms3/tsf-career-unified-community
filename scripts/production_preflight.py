"""Read-only release/data checks. Never starts services or applies migrations."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from pathlib import PurePosixPath
import re
import sqlite3
import stat
from urllib.parse import quote


def inspect_data(directory):
    database = Path(directory).resolve() / "career-hub.sqlite"
    if not database.is_file():
        return {"ready": False, "blockers": ["PERSISTENT_DATABASE_MISSING"]}
    connection = sqlite3.connect(f"file:{quote(database.as_posix(), safe='/:')}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        version = connection.execute("SELECT max(version) FROM schema_migrations").fetchone()[0]
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_keys = len(connection.execute("PRAGMA foreign_key_check").fetchall())
        blockers = []
        if not version or version < 58:
            blockers.append("MIGRATIONS_057_058_REQUIRED_ON_BACKUP_FIRST")
        if integrity != "ok" or foreign_keys:
            blockers.append("DATABASE_INTEGRITY_FAILED")
        uncertain = connection.execute("SELECT count(*) FROM applications WHERE status='SUBMISSION_UNCERTAIN'").fetchone()[0]
        schedules = connection.execute("SELECT count(*) FROM search_schedules WHERE enabled=1").fetchone()[0]
        profiles = connection.execute("SELECT count(*) FROM job_hunt_profiles WHERE enabled=1").fetchone()[0]
        if schedules or profiles:
            blockers.append("REVIEW_ACTIVE_SCHEDULES_BEFORE_INITIAL_START")
        base = connection.execute("SELECT r.title,r.resume_kind FROM resumes r JOIN app_metadata m ON m.value=r.id WHERE m.key='default_resume_id' AND r.archived_at IS NULL").fetchone()
        if not base or base["resume_kind"] != "BASE":
            blockers.append("APPROVED_BASE_MISSING")
        return {"ready": not blockers, "blockers": blockers, "schemaVersion": version,
                "integrity": integrity, "foreignKeyViolations": foreign_keys,
                "uncertainSubmissions": uncertain, "activeSchedules": schedules,
                "activeProfiles": profiles, "approvedBasePresent": bool(base)}
    finally:
        connection.close()


def inspect_release(directory):
    source = Path(directory).resolve()
    manifest_file = source / "AUDIT_CHECKSUMS.json"
    if not manifest_file.is_file():
        return {"ready": False, "blockers": ["RELEASE_MANIFEST_MISSING"]}
    manifest = json.loads(manifest_file.read_text(encoding="utf-8-sig"))
    if not isinstance(manifest, dict) or not re.fullmatch(r"[0-9a-f]{40}", str(manifest.get("commit", ""))) or not isinstance(manifest.get("sha256"), dict) or not manifest["sha256"]:
        return {"ready": False, "blockers": ["RELEASE_MANIFEST_INVALID"]}
    blockers = ["DIRTY_OR_UNVERIFIED_SOURCE_RELEASE"] if manifest.get("dirty") is not False else []
    verified = 0
    for name, expected in manifest["sha256"].items():
        relative = PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts or "\\" in name or ":" in name:
            blockers.append("RELEASE_PATH_INVALID")
            break
        candidate = (source / name).resolve()
        if not candidate.is_relative_to(source) or not candidate.is_file() or not re.fullmatch(r"[0-9a-f]{64}", str(expected)):
            blockers.append("RELEASE_FILE_INVALID")
            break
        if hashlib.sha256(candidate.read_bytes()).hexdigest() != expected:
            blockers.append("RELEASE_HASH_MISMATCH")
            break
        verified += 1
    return {"ready": not blockers, "commit": manifest["commit"], "filesVerified": verified, "blockers": blockers}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--key-file")
    args = parser.parse_args()
    report = {"readOnly": True, "blockers": []}
    for name, operation in [("data", lambda: inspect_data(args.data_dir)),
                            ("release", lambda: inspect_release(args.source_dir))]:
        try:
            report[name] = operation()
        except (OSError, ValueError, sqlite3.Error):
            report[name] = {"ready": False, "blockers": [f"{name.upper()}_CHECK_FAILED"]}
        report["blockers"].extend(report[name]["blockers"])
    if os.environ.get("CAREER_SUBMISSION_ENABLED", "").lower() != "false":
        report["blockers"].append("SUBMISSION_FLAG_MUST_BE_EXPLICITLY_FALSE")
    if not args.key_file or not Path(args.key_file).is_file():
        report["blockers"].append("MATCHING_CREDENTIAL_KEY_BACKUP_REQUIRED")
    elif os.name == "posix" and stat.S_IMODE(Path(args.key_file).stat().st_mode) & 0o077:
        report["blockers"].append("CREDENTIAL_KEY_PERMISSIONS_TOO_BROAD")
    report["credentialDecryptionVerified"] = False
    report["ready"] = not report["blockers"]
    print(json.dumps(report, indent=2))
    return 0 if report["ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
