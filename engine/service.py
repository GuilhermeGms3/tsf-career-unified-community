"""FastAPI composition root for the Career Hub engine.

Domain work lives in focused modules. Imports remain public here for backwards
compatibility with existing workers and characterization tests.
"""

import base64
import re
from typing import Any

from fastapi import FastAPI, HTTPException
from pdf2image.exceptions import PDFPopplerTimeoutError
from pytesseract import TesseractError, TesseractNotFoundError

from contracts import ExtractRequest, GenerateRequest, SearchRequest
from document_extraction import (
    decode_payload,
    extract_contact_data,
    extract_docx,
    extract_file,
    extract_pdf,
    extraction_quality_issues,
    normalize_ocr_text,
    normalized_heading,
    split_sections,
)
from document_generation import (
    add_docx_heading,
    build_docx,
    build_pdf,
    safe_text,
    section_lines,
    xml_escape,
)
from job_search import (
    build_jobspy_kwargs,
    clean_string,
    clean_value,
    compact_location,
    execute_jobspy_portal,
    jobspy_portal_worker,
    normalize_job,
    portal_report,
    salary_text,
    search_jobs as execute_search,
    summarize_portal_outcomes,
)

app = FastAPI(title="Career Hub Engine", version="1.0.0")


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "services": ["documents", "job-search", "ocr", "generation"]}


@app.post("/documents/extract")
def extract_document(request: ExtractRequest) -> dict[str, Any]:
    try:
        return {"ok": True, **extract_file(request.filename, decode_payload(request.data))}
    except (TesseractError, TesseractNotFoundError) as exc:
        raise HTTPException(status_code=502, detail="Falha ao executar o OCR do PDF.") from exc
    except (RuntimeError, PDFPopplerTimeoutError) as exc:
        if "timeout" in str(exc).lower():
            raise HTTPException(status_code=504, detail="O OCR excedeu o tempo limite.") from exc
        raise


@app.post("/documents/generate")
def generate_document(request: GenerateRequest) -> dict[str, Any]:
    return {
        "ok": True,
        "docx": base64.b64encode(build_docx(request)).decode("ascii"),
        "pdf": base64.b64encode(build_pdf(request)).decode("ascii"),
    }


@app.post("/jobs/linkedin/{job_id}/description")
def linkedin_description(job_id: str) -> dict[str, Any]:
    from linkedin_enrichment import enrich_linkedin

    if not re.fullmatch(r"\d{1,20}", job_id):
        raise HTTPException(status_code=422, detail="Invalid LinkedIn job ID")
    return {"ok": True, **enrich_linkedin(job_id)}


@app.post("/jobs/search")
def search_jobs(request: SearchRequest) -> dict[str, Any]:
    return execute_search(request)
