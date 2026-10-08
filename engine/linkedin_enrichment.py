"""Bounded public description lookup. No retries, authentication or cookie import."""
import re
import time
from bs4 import BeautifulSoup
import requests
from jobspy.util import markdown_converter
from jobspy.linkedin import LinkedIn


def enrich_linkedin(job_id):
    if not re.fullmatch(r"\d{1,20}", job_id):
        raise ValueError("Invalid LinkedIn job ID")
    started = time.monotonic()
    try:
        # Fixed origin and redirects disabled: external content cannot redirect this request.
        response = requests.get(f"https://www.linkedin.com/jobs/view/{job_id}",
                                timeout=5, allow_redirects=False)
        if response.status_code != 200:
            return {"status": "ENRICHMENT_FAILED", "httpStatus": response.status_code}
        if len(response.content) > 2_000_000:
            return {"status": "ENRICHMENT_FAILED"}
        soup = BeautifulSoup(response.text, "html.parser")
        content = soup.find("div", class_="show-more-less-html__markup")
        if not content:
            return {"status": "ENRICHMENT_FAILED"}
        application_url = LinkedIn()._parse_job_url_direct(soup) or ""
        if not application_url.startswith("https://"):
            application_url = ""
        return {"status": "ENRICHED", "description": markdown_converter(str(content))[:80000],
                "applicationUrl": application_url, "durationMs": round((time.monotonic()-started)*1000)}
    except requests.Timeout:
        return {"status": "ENRICHMENT_TIMED_OUT"}
    except requests.RequestException:
        return {"status": "ENRICHMENT_FAILED"}
