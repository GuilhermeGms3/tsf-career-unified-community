"""Explicit, bounded public LinkedIn measurement; never invoked by tests/startup."""
import json
import time
from jobspy.linkedin import LinkedIn
from jobspy.model import ScraperInput, Site, DescriptionFormat
from requests.adapters import HTTPAdapter


def measure(full_description):
    scraper = LinkedIn()
    # No retry, login, cookie import, proxy or anti-bot workarounds.
    scraper.session.mount("https://", HTTPAdapter(max_retries=0))
    calls = []
    original = scraper.session.send

    def send(request, **kwargs):
        started = time.monotonic()
        entry = {"stage": "description" if "/jobs/view/" in request.url else "discovery"}
        calls.append(entry)
        try:
            response = original(request, **kwargs)
            entry["status"] = response.status_code
            return response
        except Exception as error:
            entry["error"] = type(error).__name__
            raise
        finally:
            entry["durationMs"] = round((time.monotonic() - started) * 1000)

    scraper.session.send = send
    started = time.monotonic()
    result = scraper.scrape(ScraperInput(
        site_type=[Site.LINKEDIN], search_term="Analista de Suporte",
        location="Brasília, Distrito Federal, Brasil", results_wanted=3,
        hours_old=168, is_remote=False, linkedin_fetch_description=full_description,
        description_format=DescriptionFormat.MARKDOWN,
    ))
    return {"fullDescription": full_description, "query": "Analista de Suporte",
            "location": "Brasília, Distrito Federal, Brasil", "remote": False,
            "resultsWanted": 3, "jobs": len(result.jobs),
            "descriptions": sum(bool(job.description) for job in result.jobs),
            "durationMs": round((time.monotonic() - started) * 1000), "requests": calls}


if __name__ == "__main__":
    for full in (True, False):
        print(json.dumps(measure(full), ensure_ascii=False), flush=True)
