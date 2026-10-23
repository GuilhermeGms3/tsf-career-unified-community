import os
from typing import Any

from pydantic import BaseModel, Field

DEFAULT_COUNTRY = os.getenv("CAREER_DEFAULT_COUNTRY", "Portugal").strip() or "Portugal"


class ExtractRequest(BaseModel):
    filename: str
    data: str


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=180)
    location: str = Field(default=DEFAULT_COUNTRY, max_length=120)
    sites: list[str] = Field(default_factory=lambda: ["indeed", "linkedin", "glassdoor"])
    results_wanted: int = Field(default=20, ge=1, le=50)
    hours_old: int | None = Field(default=168, ge=1, le=2160)
    remote: bool = False
    country: str = Field(default=DEFAULT_COUNTRY, max_length=80)
    geography_surface: str = Field(default="", max_length=80)
    portal_deadline_ms: int = Field(ge=1000, le=120000)
    engine_deadline_ms: int = Field(ge=2000, le=180000)


class GenerateRequest(BaseModel):
    full_name: str
    headline: str = ""
    contact_lines: list[str] = Field(default_factory=list)
    sections: dict[str, Any] = Field(default_factory=dict)
    output_name: str = "curriculo-adaptado"
