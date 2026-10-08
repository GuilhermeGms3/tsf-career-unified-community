[CmdletBinding()]
param(
  [string]$OutputPath = "",
  [switch]$KeepStaging
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $repoRoot "tmp\audit-export\career-unified-audit-$timestamp.zip"
} elseif (-not [IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = Join-Path $repoRoot $OutputPath
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$staging = Join-Path ([IO.Path]::GetTempPath()) "career-unified-audit-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $staging | Out-Null

$allowedRoots = @(
  "src", "server", "public", "repositories", "domain", "db", "engine",
  "docs", "tests", "scripts", "automation", "browser-extension"
)
$allowedFiles = @(
  "README.md", "AUDIT_HANDOFF.md", "package.json", "package-lock.json", "server.mjs",
  "Dockerfile", "compose.yaml", ".dockerignore", ".gitignore", ".env.example",
  "start.ps1", "stop.ps1", "install-extension.ps1"
)
$excludedCategories = @(
  ".git and dependency trees", "environment files except .env.example",
  "runtime data and SQLite databases", "WAL and SHM files", "secrets and credentials",
  "browser profiles, screenshots and traces", "runtime caches and logs",
  "downloads or generated artifacts that may contain PII", "QR codes",
  "community raw payloads, conversation history, participant lists and contact identifiers"
)

function Test-AuditFileAllowed([string]$RelativePath) {
  $normalized = $RelativePath.Replace("\", "/")
  $segments = $normalized.Split("/")
  $blockedSegments = @(".git", "node_modules", ".venv", "venv", "__pycache__", "data", "tmp", "artifacts", "coverage", "build", "dist", "downloads", "secrets", "credentials", "browser-profile", "browser-profiles", "screenshots", "traces", "cache", "caches", "logs")
  foreach ($segment in $segments) {
    if ($blockedSegments -contains $segment.ToLowerInvariant()) { return $false }
  }
  $name = [IO.Path]::GetFileName($normalized).ToLowerInvariant()
  if ($name -eq ".env") { return $false }
  if ($name.StartsWith(".env.") -and $name -ne ".env.example") { return $false }
  if ($name -match "\.(sqlite|sqlite-wal|sqlite-shm|db|wal|shm|log)$") { return $false }
  if ($name -match "(^|[-_.])(qr|qrcode)([-_.]|$)") { return $false }
  if ($name -match "\.(png|jpe?g|webp|trace|har)$" -and $normalized -match "(?i)(automation|application|whatsapp|runtime)") { return $false }
  return $true
}

try {
  $candidates = [Collections.Generic.List[IO.FileInfo]]::new()
  foreach ($relativeRoot in $allowedRoots) {
    $root = Join-Path $repoRoot $relativeRoot
    if (Test-Path -LiteralPath $root) {
      Get-ChildItem -LiteralPath $root -File -Recurse | ForEach-Object { $candidates.Add($_) }
    }
  }
  foreach ($relativeFile in $allowedFiles) {
    $file = Join-Path $repoRoot $relativeFile
    if (Test-Path -LiteralPath $file -PathType Leaf) { $candidates.Add((Get-Item -LiteralPath $file)) }
  }

  $included = [Collections.Generic.List[string]]::new()
  foreach ($file in $candidates | Sort-Object FullName -Unique) {
    $relative = $file.FullName.Substring($repoRoot.Length).TrimStart([char[]]@("\", "/"))
    if (-not (Test-AuditFileAllowed $relative)) { continue }
    $target = Join-Path $staging $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target
    $included.Add($relative.Replace("\", "/"))
  }

  $commit = (& git -c "safe.directory=$($repoRoot.Replace('\','/'))" -C $repoRoot rev-parse HEAD 2>$null)
  if (-not $commit) { $commit = "unavailable" }
  $manifest = @(
    "# Career Unified Audit Manifest", "", "- Generated at: $((Get-Date).ToUniversalTime().ToString('o'))",
    "- Commit: $commit", "- Included files: $($included.Count)", "", "## Excluded categories", ""
  ) + ($excludedCategories | ForEach-Object { "- $_" }) + @("", "## Included files", "") + ($included | ForEach-Object { "- ``$_``" })
  [IO.File]::WriteAllLines((Join-Path $staging "AUDIT_MANIFEST.md"), $manifest, [Text.UTF8Encoding]::new($false))

  if (Test-Path -LiteralPath $OutputPath) { Remove-Item -LiteralPath $OutputPath -Force }
  [IO.Compression.ZipFile]::CreateFromDirectory($staging, $OutputPath, [IO.Compression.CompressionLevel]::Optimal, $false)
  Write-Output $OutputPath
} finally {
  if (-not $KeepStaging -and (Test-Path -LiteralPath $staging)) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
