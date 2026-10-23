import hashlib
import logging
import math
import multiprocessing as mp
import os
import queue
import re
import time
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException

from contracts import DEFAULT_COUNTRY, SearchRequest


def clean_value(value: Any) -> Any:
    if value is None or isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "item"):
        try:
            return clean_value(value.item())
        except Exception:
            pass
    return value


def clean_string(value: Any) -> str:
    return re.sub(r"\s+", " ", str(clean_value(value) or "").replace("\ufffd", "")).strip()


def compact_location(record: dict[str, Any]) -> str:
    unique: list[str] = []
    for raw in [record.get("location"), record.get("city"), record.get("state"), record.get("country")]:
        value = clean_string(raw)
        if value and value.lower() not in {item.lower() for item in unique}:
            unique.append(value)
    return ", ".join(unique)


def salary_text(record: dict[str, Any]) -> str:
    minimum, maximum = clean_value(record.get("min_amount")), clean_value(record.get("max_amount"))
    if minimum is None and maximum is None:
        return ""
    currency, interval = clean_string(record.get("currency")), clean_string(record.get("interval"))
    values = [f"{float(value):,.0f}".replace(",", ".") for value in [minimum, maximum] if value is not None]
    return " - ".join(values) + (f" {currency}" if currency else "") + (f" / {interval}" if interval else "")


def normalize_job(record: dict[str, Any]) -> dict[str, Any]:
    url = clean_string(record.get("job_url_direct") or record.get("job_url"))
    source = clean_string(record.get("site") or "desconhecido").lower()
    external_id = clean_string(record.get("id"))
    stable = external_id or hashlib.sha1(f"{source}|{url}".encode()).hexdigest()[:20]
    return {
        "externalId": f"{source}:{stable}", "source": source,
        "title": clean_string(record.get("title")), "company": clean_string(record.get("company")),
        "location": compact_location(record), "city": clean_string(record.get("city")),
        "state": clean_string(record.get("state")), "country": clean_string(record.get("country")),
        "workModel": "Remoto" if bool(clean_value(record.get("is_remote"))) else "",
        "isRemote": bool(clean_value(record.get("is_remote"))), "salary": salary_text(record),
        "salaryMin": clean_value(record.get("min_amount")), "salaryMax": clean_value(record.get("max_amount")),
        "salaryCurrency": clean_string(record.get("currency")), "salaryInterval": clean_string(record.get("interval")),
        "description": clean_string(record.get("description")), "url": url,
        "sourceUrl": clean_string(record.get("job_url")), "applicationUrl": clean_string(record.get("job_url_direct")) or url,
        "datePosted": clean_value(record.get("date_posted")), "jobType": clean_string(record.get("job_type")),
    }


def portal_report(payload: dict[str, Any], status: str, started: float, started_at: str, **extra: Any) -> dict[str, Any]:
    elapsed = round((time.monotonic() - started) * 1000)
    count = max(0, int(extra.pop("count", 0)))
    return {"source": payload["site"], "site": payload["site"], "attempted": extra.pop("attempted", True), "status": status, "count": count, "rawResults": count, "acceptedResults": count, "durationMs": elapsed, "elapsedMs": elapsed, "query": payload["query"], "location": payload["location"], "country": payload["country"], "remote": payload["remote"], "geographySurface": payload["geography_surface"], "startedAt": started_at, "completedAt": datetime.utcnow().isoformat() + "Z", **extra}


def build_jobspy_kwargs(payload: dict[str, Any]) -> dict[str, Any]:
    site = payload["site"]
    kwargs: dict[str, Any] = {"site_name": [site], "search_term": payload["query"], "location": payload["location"], "country_indeed": payload["country"], "results_wanted": payload["results_wanted"], "description_format": "markdown", "verbose": 0}
    if site == "linkedin":
        kwargs["linkedin_fetch_description"] = False
    if payload.get("hours_old"):
        kwargs["hours_old"] = payload["hours_old"]
    if payload["remote"]:
        kwargs["is_remote"] = True
    if site == "google":
        kwargs["google_search_term"] = f"{payload['query']} vagas {payload['location']}"
    return kwargs


def execute_jobspy_portal(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    from jobspy import scrape_jobs

    started, started_at = time.monotonic(), datetime.utcnow().isoformat() + "Z"
    captured_errors: list[str] = []

    class PortalErrorHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            if record.levelno >= logging.ERROR:
                captured_errors.append(clean_string(record.getMessage()))

    error_handler = PortalErrorHandler()
    portal_logger = logging.getLogger(f"JobSpy:{payload['site'].title()}")
    portal_logger.addHandler(error_handler)
    try:
        raw_records = scrape_jobs(**build_jobspy_kwargs(payload)).to_dict(orient="records")
        records = [normalize_job(record) for record in raw_records]
        if payload["site"] == "linkedin":
            for record in records:
                record["provenance"] = {"linkedinSearch": {"remoteFilter": payload["remote"], "descriptionFetched": False}}
                if payload["remote"]:
                    record["isRemote"], record["workModel"] = True, "Remoto"
        records = [record for record in records if record["title"] and record["company"]]
        if records:
            report = portal_report(payload, "SUCCESS", started, started_at, count=len(records), message=f"{len(records)} vaga(s) encontrada(s).")
        elif captured_errors:
            detail = " ".join(captured_errors).lower()
            if "403" in detail or "forbidden" in detail or "blocked" in detail:
                status, code, message = "FAILED", "PORTAL_BLOCKED", "O portal bloqueou esta consulta automatizada."
            elif "location not parsed" in detail or "location" in detail and "400" in detail:
                status, code, message = "FAILED", "PORTAL_LOCATION_UNSUPPORTED", "O portal não reconheceu a localização solicitada."
            else:
                status, code, message = "FAILED", "PORTAL_FAILED", "A fonte falhou nesta tentativa."
            report = portal_report(payload, status, started, started_at, message=message, errorCode=code)
        else:
            report = portal_report(payload, "NO_RESULTS", started, started_at, message="Nenhuma vaga encontrada com estes filtros.")
        report["rawResults"] = len(raw_records)
        report["normalizationLosses"] = len(raw_records) - len(records)
        return records, report
    except Exception as exc:
        lowered = clean_string(exc).lower()
        if "429" in lowered or "rate" in lowered or "too many" in lowered:
            status, code, message = "RATE_LIMITED", "PORTAL_RATE_LIMITED", "O portal limitou temporariamente as buscas."
        elif "timeout" in lowered or "timed out" in lowered:
            status, code, message = "TIMED_OUT", "PORTAL_TIMEOUT", "O portal demorou demais para responder."
        elif "403" in lowered or "forbidden" in lowered or "blocked" in lowered:
            status, code, message = "FAILED", "PORTAL_BLOCKED", "O portal bloqueou esta consulta automatizada."
        else:
            status, code, message = "FAILED", "PORTAL_FAILED", "A fonte falhou nesta tentativa."
        return [], portal_report(payload, status, started, started_at, message=message, errorCode=code)
    finally:
        portal_logger.removeHandler(error_handler)


def jobspy_portal_worker(payload: dict[str, Any], output: Any) -> None:
    if payload["site"] != "linkedin":
        output.put(execute_jobspy_portal(payload))
        return
    from urllib3.connectionpool import HTTPSConnectionPool
    original, requests_count = HTTPSConnectionPool.urlopen, 0

    def counted(pool, *args, **kwargs):
        nonlocal requests_count
        if pool.host == "linkedin.com" or pool.host.endswith(".linkedin.com"):
            requests_count += 1
        return original(pool, *args, **kwargs)

    HTTPSConnectionPool.urlopen = counted
    try:
        records, report = execute_jobspy_portal(payload)
        report["externalRequests"] = requests_count
        output.put((records, report))
    finally:
        HTTPSConnectionPool.urlopen = original


def summarize_portal_outcomes(records: list[dict[str, Any]], reports: list[dict[str, Any]]) -> str:
    failed = any(item["status"] in {"FAILED", "TIMED_OUT", "RATE_LIMITED", "NOT_ATTEMPTED"} for item in reports)
    return "PARTIAL_SUCCESS" if records and failed else "SUCCESS" if records else "DEGRADED" if failed else "NO_RESULTS"


def search_jobs(request: SearchRequest) -> dict[str, Any]:
    if request.portal_deadline_ms >= request.engine_deadline_ms:
        raise HTTPException(status_code=422, detail="portal_deadline_ms deve ser menor que engine_deadline_ms.")
    allowed = {"indeed", "linkedin", "glassdoor", "google"}
    sites = list(dict.fromkeys(site for site in request.sites if site in allowed)) or ["indeed"]
    concurrency = max(1, min(4, int(os.getenv("JOBSPY_PORTAL_CONCURRENCY", "2"))))
    operation_started = time.monotonic()
    operation_deadline = operation_started + request.engine_deadline_ms / 1000
    pending, active, records, reports = list(sites), {}, [], []

    def payload_for(site: str) -> dict[str, Any]:
        return {"site": site, "query": request.query, "location": request.location or DEFAULT_COUNTRY, "country": request.country or DEFAULT_COUNTRY, "geography_surface": request.geography_surface, "remote": request.remote, "results_wanted": request.results_wanted, "hours_old": request.hours_old}

    while pending or active:
        current_time = time.monotonic()
        while pending and len(active) < concurrency and current_time < operation_deadline:
            site = pending.pop(0)
            output = mp.Queue(maxsize=1)
            process = mp.Process(target=jobspy_portal_worker, args=(payload_for(site), output), daemon=True)
            process.start()
            active[site] = {"process": process, "output": output, "started": time.monotonic(), "started_at": datetime.utcnow().isoformat() + "Z"}
        progressed = False
        for site, state in list(active.items()):
            process, output = state["process"], state["output"]
            try:
                source_records, report = output.get_nowait()
                process.join(timeout=.2)
                records.extend(source_records); reports.append(report); del active[site]; progressed = True
                continue
            except queue.Empty:
                pass
            elapsed_ms = round((time.monotonic() - state["started"]) * 1000)
            if elapsed_ms >= request.portal_deadline_ms or time.monotonic() >= operation_deadline:
                process.terminate(); process.join(timeout=1)
                reports.append(portal_report(payload_for(site), "TIMED_OUT", state["started"], state["started_at"], message="O portal excedeu o deadline isolado.", errorCode="PORTAL_TIMEOUT"))
                del active[site]; progressed = True
            elif not process.is_alive():
                process.join(timeout=.2)
                try:
                    source_records, report = output.get(timeout=.2)
                    records.extend(source_records); reports.append(report)
                except queue.Empty:
                    reports.append(portal_report(payload_for(site), "FAILED", state["started"], state["started_at"], message="O processo isolado do portal terminou sem resposta.", errorCode="PORTAL_PROCESS_FAILED"))
                del active[site]; progressed = True
        if time.monotonic() >= operation_deadline and pending:
            for site in pending:
                reports.append(portal_report(payload_for(site), "NOT_ATTEMPTED", operation_started, datetime.utcnow().isoformat() + "Z", attempted=False, message="O deadline da operação encerrou antes deste portal.", errorCode="ENGINE_DEADLINE_REACHED"))
            pending.clear()
        if not progressed:
            time.sleep(.02)
    reports.sort(key=lambda item: sites.index(item["source"]))
    return {"ok": True, "status": summarize_portal_outcomes(records, reports), "jobs": records, "count": len(records), "sites": sites, "sourceReports": reports, "deadlines": {"portalDeadlineMs": request.portal_deadline_ms, "engineDeadlineMs": request.engine_deadline_ms}}
