import sys
import logging
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import service


class Frame:
    def to_dict(self, orient="records"):
        return [{"id": "1", "site": "indeed", "title": "Backend Junior", "company": "Acme", "is_remote": True}]


class CareerEngineTests(unittest.TestCase):
    def test_remote_flag_reaches_jobspy_even_with_hours_old(self):
        captured = {}

        def scrape_jobs(**kwargs):
            captured.update(kwargs)
            return Frame()

        previous = sys.modules.get("jobspy")
        sys.modules["jobspy"] = SimpleNamespace(scrape_jobs=scrape_jobs)
        try:
            jobs, report = service.execute_jobspy_portal({
                "site": "indeed", "query": "Backend", "location": "Brazil",
                "country": "Brazil", "geography_surface": "REMOTE_BRAZIL",
                "remote": True, "results_wanted": 10, "hours_old": 168,
            })
        finally:
            if previous is None:
                del sys.modules["jobspy"]
            else:
                sys.modules["jobspy"] = previous
        self.assertTrue(captured["is_remote"])
        self.assertEqual(captured["hours_old"], 168)
        self.assertEqual(report["status"], "SUCCESS")
        self.assertEqual(len(jobs), 1)

    def test_one_timeout_preserves_other_portal_results(self):
        reports = [
            {"site": "indeed", "status": "SUCCESS"},
            {"site": "linkedin", "status": "TIMED_OUT"},
            {"site": "glassdoor", "status": "SUCCESS"},
            {"site": "google", "status": "SUCCESS"},
        ]
        self.assertEqual(service.summarize_portal_outcomes([{"id": "1"}], reports), "PARTIAL_SUCCESS")

    def test_glassdoor_logged_block_is_not_reported_as_empty(self):
        class EmptyFrame:
            def to_dict(self, orient="records"):
                return []

        def scrape_jobs(**kwargs):
            logging.getLogger("JobSpy:Glassdoor").error("Glassdoor: bad response status code: 403")
            return EmptyFrame()

        previous = sys.modules.get("jobspy")
        sys.modules["jobspy"] = SimpleNamespace(scrape_jobs=scrape_jobs)
        try:
            jobs, report = service.execute_jobspy_portal({
                "site": "glassdoor", "query": "Backend", "location": "Brazil",
                "country": "Brazil", "geography_surface": "REMOTE_BRAZIL",
                "remote": True, "results_wanted": 10, "hours_old": 168,
            })
        finally:
            if previous is None:
                del sys.modules["jobspy"]
            else:
                sys.modules["jobspy"] = previous
        self.assertEqual(jobs, [])
        self.assertEqual(report["status"], "FAILED")
        self.assertEqual(report["errorCode"], "PORTAL_BLOCKED")

    def test_glassdoor_location_error_is_not_reported_as_empty(self):
        class EmptyFrame:
            def to_dict(self, orient="records"):
                return []

        def scrape_jobs(**kwargs):
            logger = logging.getLogger("JobSpy:Glassdoor")
            logger.error("Glassdoor response status code 400")
            logger.error("Glassdoor: location not parsed")
            return EmptyFrame()

        previous = sys.modules.get("jobspy")
        sys.modules["jobspy"] = SimpleNamespace(scrape_jobs=scrape_jobs)
        try:
            _, report = service.execute_jobspy_portal({
                "site": "glassdoor", "query": "Backend", "location": "Brasília, Federal District, Brazil",
                "country": "Brazil", "geography_surface": "LOCAL_DF",
                "remote": False, "results_wanted": 10, "hours_old": 168,
            })
        finally:
            if previous is None:
                del sys.modules["jobspy"]
            else:
                sys.modules["jobspy"] = previous
        self.assertEqual(report["status"], "FAILED")
        self.assertEqual(report["errorCode"], "PORTAL_LOCATION_UNSUPPORTED")

    def test_linkedin_description_flag_is_scoped_and_request_metadata_is_preserved(self):
        base = {
            "query": "Backend", "location": "Brazil", "country": "Brazil",
            "geography_surface": "REMOTE_BRAZIL", "remote": True,
            "results_wanted": 10, "hours_old": 168,
        }
        linkedin = service.build_jobspy_kwargs({**base, "site": "linkedin"})
        indeed = service.build_jobspy_kwargs({**base, "site": "indeed"})
        self.assertFalse(linkedin["linkedin_fetch_description"])
        self.assertNotIn("linkedin_fetch_description", indeed)
        for key in ["search_term", "location", "country_indeed", "results_wanted", "hours_old", "is_remote"]:
            self.assertEqual(linkedin[key], indeed[key])

    def test_extracts_explicit_resume_contact_with_provenance(self):
        contact = service.extract_contact_data("Ana Silva\nBrasília, DF\nana@example.test\n(61) 99999-0000\nhttps://linkedin.com/in/ana\nExperiência\nLinux")
        self.assertEqual("ana@example.test", contact["email"]["value"])
        self.assertEqual("RESUME_PDF", contact["email"]["source"])
        self.assertEqual("Brasília, DF", contact["location"]["value"])

    def test_local_df_never_adds_remote_filter(self):
        kwargs = service.build_jobspy_kwargs({"site":"linkedin", "query":"Analista de Suporte", "location":"Brasília, DF", "country":"Brazil", "remote":False, "results_wanted":3, "hours_old":168})
        self.assertNotIn("is_remote", kwargs)
        self.assertEqual(kwargs["location"], "Brasília, DF")
        self.assertFalse(kwargs["linkedin_fetch_description"])

    def test_normalization_keeps_discovery_url_separate_from_apply_url(self):
        job = service.normalize_job({"site":"linkedin", "job_url":"https://www.linkedin.com/jobs/view/123", "job_url_direct":"https://fixture.gupy.io/jobs/123", "city":"Brasília", "state":"DF", "country":"Brazil"})
        self.assertEqual(job["sourceUrl"], "https://www.linkedin.com/jobs/view/123")
        self.assertEqual(job["applicationUrl"], "https://fixture.gupy.io/jobs/123")
        self.assertEqual(job["city"], "Brasília")
        self.assertEqual(job["state"], "DF")
        self.assertEqual(job["country"], "Brazil")

    def test_linkedin_enrichment_has_fixed_origin_and_no_redirect(self):
        from linkedin_enrichment import enrich_linkedin
        response = SimpleNamespace(status_code=200,content=b"small",text='<div class="show-more-less-html__markup">Docker required</div>')
        with patch("linkedin_enrichment.requests.get", return_value=response) as request:
            result = enrich_linkedin("123")
            self.assertEqual(result["status"], "ENRICHED")
            self.assertIn("Docker", result["description"])
            request.assert_called_once_with("https://www.linkedin.com/jobs/view/123", timeout=5, allow_redirects=False)
        with self.assertRaises(ValueError):
            enrich_linkedin("../user")

    def test_linkedin_enrichment_timeout_is_not_discovery_failure(self):
        import requests
        from linkedin_enrichment import enrich_linkedin
        with patch("linkedin_enrichment.requests.get", side_effect=requests.Timeout):
            self.assertEqual(enrich_linkedin("123")["status"], "ENRICHMENT_TIMED_OUT")


if __name__ == "__main__":
    unittest.main()
