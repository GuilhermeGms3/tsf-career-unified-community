FROM node:22-bookworm-slim

ARG TECTONIC_VERSION=0.17.0
ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

RUN case "$TARGETARCH" in \
      amd64) TECTONIC_ARCH="x86_64"; TECTONIC_SHA256="8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7" ;; \
      arm64) TECTONIC_ARCH="aarch64"; TECTONIC_SHA256="b10954a95404f3ab2328d2fa59a5ebab8e657f893fab096f98be8db7c0c979b8" ;; \
      *) echo "Arquitetura Docker nao suportada: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && TECTONIC_FILE="tectonic-${TECTONIC_VERSION}-${TECTONIC_ARCH}-unknown-linux-musl.tar.gz" \
 && curl --fail --location --retry 3 "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/${TECTONIC_FILE}" --output "/tmp/${TECTONIC_FILE}" \
 && echo "${TECTONIC_SHA256}  /tmp/${TECTONIC_FILE}" | sha256sum --check - \
 && tar -xzf "/tmp/${TECTONIC_FILE}" -C /usr/local/bin tectonic \
 && rm "/tmp/${TECTONIC_FILE}" \
 && tectonic --version

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium

ENV XDG_CACHE_HOME=/opt/tectonic-cache
ENV TECTONIC_UNTRUSTED_MODE=1
COPY docker/tectonic-warm/resume.tex /opt/tectonic-warm/resume.tex
COPY docker/tectonic-warm/resume-alt.tex /opt/tectonic-warm/resume-alt.tex
RUN mkdir -p "$XDG_CACHE_HOME" /tmp/tectonic-warm \
 && tectonic --untrusted --keep-logs --outdir /tmp/tectonic-warm /opt/tectonic-warm/resume.tex \
 && tectonic --untrusted --only-cached --outdir /tmp/tectonic-warm /opt/tectonic-warm/resume.tex \
 && tectonic --untrusted --keep-logs --outdir /tmp/tectonic-warm /opt/tectonic-warm/resume-alt.tex \
 && tectonic --untrusted --only-cached --outdir /tmp/tectonic-warm /opt/tectonic-warm/resume-alt.tex \
 && rm -rf /tmp/tectonic-warm
COPY docker/tectonic-warm/resume-fonts.tex /opt/tectonic-warm/resume-fonts.tex
RUN mkdir -p /tmp/tectonic-font-warm \
 && tectonic --untrusted --outdir /tmp/tectonic-font-warm /opt/tectonic-warm/resume-fonts.tex \
 && tectonic --untrusted --only-cached --outdir /tmp/tectonic-font-warm /opt/tectonic-warm/resume-fonts.tex \
 && rm -rf /tmp/tectonic-font-warm

COPY server.mjs ./
COPY server ./server
COPY db ./db
COPY domain ./domain
COPY repositories ./repositories
COPY src ./src
COPY scripts ./scripts

COPY public ./public
COPY data ./data

RUN mkdir -p resources \
 && git clone --depth 1 https://github.com/bregman-arie/devops-exercises.git resources/devops-exercises \
 && git clone --depth 1 https://github.com/trimstray/test-your-sysadmin-skills.git resources/sysadmin-skills \
 && git clone --depth 1 https://github.com/keraattin/Blue-Team-Roadmap.git resources/blue-team-roadmap \
 && git clone --depth 1 https://github.com/yangshun/tech-interview-handbook.git resources/interview-handbook \
 && find resources -type d -name .git -prune -exec rm -rf {} +

ENV NODE_ENV=production
ENV HUB_HOST=0.0.0.0
ENV HUB_PORT=7123
ENV OLLAMA_URL=http://host.docker.internal:11434

EXPOSE 7123

CMD ["node", "server.mjs"]
