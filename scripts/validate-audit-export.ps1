[CmdletBinding()]
param([string]$Path = "")

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($Path)) {
  $exportRoot = Join-Path $repoRoot "tmp\audit-export"
  $latest = Get-ChildItem -LiteralPath $exportRoot -Filter "career-unified-audit-*.zip" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $latest) { throw "Nenhum ZIP de auditoria foi encontrado em $exportRoot." }
  $Path = $latest.FullName
}
$resolved = (Resolve-Path -LiteralPath $Path).Path
$archive = [IO.Compression.ZipFile]::OpenRead($resolved)
$extractRoot = Join-Path ([IO.Path]::GetTempPath()) "career-unified-audit-validate-$([guid]::NewGuid())"
$resolvedExtractRoot = [IO.Path]::GetFullPath($extractRoot)
$resolvedTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $resolvedExtractRoot.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Diretório de validação fora da pasta temporária permitida."
}
try {
  $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
  if ($entries -notcontains "AUDIT_MANIFEST.md") { throw "AUDIT_MANIFEST.md ausente." }
  $forbidden = $entries | Where-Object {
    $_ -match "(^|/)(\.git|node_modules|\.venv|venv|__pycache__|data|tmp|artifacts|coverage|build|dist|downloads|secrets|credentials|browser-profiles?|screenshots|traces|caches?|logs)(/|$)" -or
    $_ -match "(^|/)\.env($|\.)" -and $_ -notmatch "(^|/)\.env\.example$" -or
    $_ -match "\.(sqlite|sqlite-wal|sqlite-shm|db|wal|shm|log)$" -or
    [IO.Path]::GetFileName($_) -match "(?i)(^|[-_.])(qr|qrcode)([-_.]|$)"
  }
  if ($forbidden) { throw "Conteúdo proibido no ZIP: $($forbidden -join ', ')" }
  $required = @(
    "server.mjs", "engine/service.py", "engine/requirements.txt", "db/database.mjs", "db/migrations/015_discovery_v4_1_analysis_without_resume.sql",
    "db/migrations/019_application_engine_v2.sql", "src/application/submission-preflight.mjs",
    "src/automation/ats/gupy/gupy-adapter.mjs", "src/application/greenhouse-final-revalidator.mjs",
    "src/application/submission-reconciliation-service.mjs", "src/application/submission-receipt-security.mjs",
    "src/automation/ats/greenhouse/greenhouse-target-policy.mjs", "tests/controlled-submit-v2-1.test.mjs",
    "src/application/lever-final-revalidator.mjs", "src/automation/ats/lever/lever-target-policy.mjs",
    "tests/lever-controlled-submit.test.mjs", "docs/controlled-submit-production-path.md",
    "docs/greenhouse-controlled-submit.md", "docs/lever-controlled-submit.md",
    "tests/application-v2-migration.test.mjs",
    "tests/analysis-without-resume-v4-1.test.mjs", "tests/cross-source-reconciliation-v4-1.test.mjs"
  )
  $missing = $required | Where-Object { $entries -notcontains $_ }
  if ($missing) { throw "Conteúdo obrigatório ausente: $($missing -join ', ')" }
  New-Item -ItemType Directory -Path $extractRoot | Out-Null
  [IO.Compression.ZipFile]::ExtractToDirectory($resolved, $extractRoot)
  Push-Location $extractRoot
  try {
    & node --check server.mjs
    if ($LASTEXITCODE -ne 0) { throw "server.mjs falhou no node --check da extração limpa." }
    & node --test --test-concurrency=1 tests/application-v2-migration.test.mjs tests/analysis-without-resume-v4-1.test.mjs tests/cross-source-reconciliation-v4-1.test.mjs
    if ($LASTEXITCODE -ne 0) { throw "Testes mínimos falharam na extração limpa." }
  } finally { Pop-Location }
  Write-Output "AUDIT ZIP VALID AND CLEAN-EXTRACTED: $($entries.Count) entries"
} finally {
  $archive.Dispose()
  if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }
}
