$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker Desktop nao esta rodando. Abra o Docker Desktop e execute este arquivo novamente."
}

docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
  throw "Nao foi possivel iniciar o Career Hub."
}

Start-Process "http://localhost:7123"
