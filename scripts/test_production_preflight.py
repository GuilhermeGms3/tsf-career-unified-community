import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from production_preflight import inspect_data, inspect_release


class ProductionPreflightTests(unittest.TestCase):
    def test_missing_database_never_creates_it(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertFalse(inspect_data(directory)["ready"])
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_release_hashes_and_tamper(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.mjs"
            source.write_text("export const fixture = true;", encoding="utf-8")
            manifest = {"commit": "a" * 40, "dirty": False, "sha256": {"source.mjs": hashlib.sha256(source.read_bytes()).hexdigest()}}
            (root / "AUDIT_CHECKSUMS.json").write_text(json.dumps(manifest), encoding="utf-8")
            self.assertTrue(inspect_release(root)["ready"])
            del manifest["dirty"]
            (root / "AUDIT_CHECKSUMS.json").write_text(json.dumps(manifest), encoding="utf-8")
            self.assertIn("DIRTY_OR_UNVERIFIED_SOURCE_RELEASE", inspect_release(root)["blockers"])
            manifest["dirty"] = False
            (root / "AUDIT_CHECKSUMS.json").write_text(json.dumps(manifest), encoding="utf-8")
            source.write_text("tampered", encoding="utf-8")
            self.assertIn("RELEASE_HASH_MISMATCH", inspect_release(root)["blockers"])

    def test_release_rejects_traversal_and_missing_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = {"commit": "a" * 40, "sha256": {"../outside": "a" * 64}}
            target = root / "AUDIT_CHECKSUMS.json"
            target.write_text(json.dumps(manifest), encoding="utf-8")
            self.assertIn("RELEASE_PATH_INVALID", inspect_release(root)["blockers"])
            target.write_text("{}", encoding="utf-8")
            self.assertIn("RELEASE_MANIFEST_INVALID", inspect_release(root)["blockers"])

    def test_schema_and_schedules_checked_without_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "career-hub.sqlite"
            connection = sqlite3.connect(file)
            connection.executescript("""
              CREATE TABLE schema_migrations(version INTEGER);
              INSERT INTO schema_migrations VALUES(56);
              CREATE TABLE applications(status TEXT);
              INSERT INTO applications VALUES('SUBMISSION_UNCERTAIN');
              CREATE TABLE search_schedules(enabled INTEGER);
              INSERT INTO search_schedules VALUES(1);
              CREATE TABLE job_hunt_profiles(enabled INTEGER);
              CREATE TABLE resumes(id TEXT,title TEXT,resume_kind TEXT,archived_at TEXT);
              INSERT INTO resumes VALUES('base','BASE 01','BASE',NULL);
              CREATE TABLE app_metadata(key TEXT,value TEXT);
              INSERT INTO app_metadata VALUES('default_resume_id','base');
            """)
            connection.close()
            before = hashlib.sha256(file.read_bytes()).hexdigest()
            result = inspect_data(directory)
            self.assertEqual(result["uncertainSubmissions"], 1)
            self.assertIn("MIGRATIONS_057_058_REQUIRED_ON_BACKUP_FIRST", result["blockers"])
            self.assertIn("REVIEW_ACTIVE_SCHEDULES_BEFORE_INITIAL_START", result["blockers"])
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(), before)


if __name__ == "__main__":
    unittest.main()
