FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-por \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /engine

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY service.py linkedin_enrichment.py ./

EXPOSE 7130

CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "7130"]
