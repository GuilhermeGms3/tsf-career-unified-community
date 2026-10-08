$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repositoryRoot

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker Desktop nao esta rodando."
}

docker compose up -d --build --remove-orphans
if ($LASTEXITCODE -ne 0) {
  throw "Nao foi possivel construir e iniciar os containers."
}

$deadline = (Get-Date).AddMinutes(4)
$services = @("career-engine", "app")

foreach ($service in $services) {
  do {
    $containerId = docker compose ps -q $service
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($containerId)) {
      throw "O container do servico '$service' nao foi criado."
    }

    $health = docker inspect --format "{{.State.Health.Status}}" $containerId
    if ($LASTEXITCODE -ne 0) {
      throw "Nao foi possivel consultar o servico '$service'."
    }

    if ($health -eq "unhealthy") {
      docker compose logs --tail 100 $service
      throw "O servico '$service' ficou unhealthy."
    }

    if ($health -ne "healthy") {
      Start-Sleep -Seconds 5
    }
  } while ($health -ne "healthy" -and (Get-Date) -lt $deadline)

  if ($health -ne "healthy") {
    docker compose logs --tail 100 $service
    throw "O servico '$service' nao ficou healthy dentro do tempo limite."
  }
}

$response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:7123/api/projects" -TimeoutSec 15
if ($response.StatusCode -ne 200) {
  throw "O smoke test retornou HTTP $($response.StatusCode)."
}

docker compose ps
Write-Output "Career Hub disponivel em http://127.0.0.1:7123"
