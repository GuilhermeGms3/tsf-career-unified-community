[CmdletBinding()]
param(
  [string]$OutputPath = "",
  [switch]$KeepStaging
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
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
$tempBoundary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([char[]]@("\", "/")) + [IO.Path]::DirectorySeparatorChar
if (-not ([IO.Path]::GetFullPath($staging)).StartsWith($tempBoundary, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Diretorio de staging fora da pasta temporaria permitida."
}
New-Item -ItemType Directory -Path $staging | Out-Null

$allowedRoots = @(
  "src", "server", "public", "repositories", "domain", "db", "engine",
  "docs", "tests", "scripts", "automation", "browser-extension", "docker", ".github"
)
$allowedFiles = @(
  "README.md", "AUDIT_HANDOFF.md", "package.json", "package-lock.json", "server.mjs",
  "Dockerfile", "compose.yaml", "compose.evolution-compat.yaml", "compose.portainer.yaml",
  ".dockerignore", ".gitignore", ".env.example", "data/.gitkeep", "resources/.gitkeep",
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
  if ($normalized -in @("data/.gitkeep", "resources/.gitkeep", "src/intelligence/cache/intelligence-cache.mjs")) { return $true }
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
  if ($name -match "\.(pem|key|pfx|p12|har|trace|jsonl)$") { return $false }
  # This is a source archive, not an export of documents or generated media.
  $sourceExtensions = @(".mjs", ".cjs", ".js", ".ts", ".tsx", ".jsx", ".py", ".ps1", ".sh", ".html", ".css", ".svg", ".sql", ".json", ".yaml", ".yml", ".md", ".mmd", ".txt", ".tex", ".toml", ".ini", ".cfg")
  return $sourceExtensions -contains [IO.Path]::GetExtension($name) -or $name -in @("dockerfile", ".env.example", ".dockerignore", ".gitignore", ".gitkeep")
}

try {
  # Respect Git's ignored runtime files, while retaining current uncommitted source.
  $gitCandidates = @(& git -C $repoRoot -c core.quotepath=false ls-files --cached --others --exclude-standard)
  if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel enumerar o codigo do repositorio." }
  $candidates = [Collections.Generic.List[IO.FileInfo]]::new()
  foreach ($relative in $gitCandidates) {
    $normalized = $relative.Replace("\", "/")
    $root = $normalized.Split("/")[0]
    if ($allowedRoots -notcontains $root -and $allowedFiles -notcontains $normalized) { continue }
    $file = Join-Path $repoRoot $relative
    if (Test-Path -LiteralPath $file -PathType Leaf) { $candidates.Add((Get-Item -LiteralPath $file)) }
  }

  $included = [Collections.Generic.List[string]]::new()
  $hashes = [ordered]@{}
  foreach ($file in $candidates | Sort-Object FullName -Unique) {
    $relative = $file.FullName.Substring($repoRoot.Length).TrimStart([char[]]@("\", "/"))
    if (-not (Test-AuditFileAllowed $relative)) { continue }
    $target = Join-Path $staging $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target
    $included.Add($relative.Replace("\", "/"))
    $hashes[$relative.Replace("\", "/")] = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  }

  $commit = (& git -c "safe.directory=$($repoRoot.Replace('\','/'))" -C $repoRoot rev-parse HEAD 2>$null)
  if (-not $commit) { $commit = "unavailable" }
  $branch = & git -C $repoRoot branch --show-current
  $dirty = [bool](& git -C $repoRoot status --porcelain)
  $manifest = @(
    "# Career Unified Audit Manifest", "", "- Generated at: $((Get-Date).ToUniversalTime().ToString('o'))",
    "- Commit: $commit", "- Branch: $branch", "- Worktree changes: $dirty",
    "- Included files: $($included.Count)", "", "## Excluded categories", ""
  ) + ($excludedCategories | ForEach-Object { "- $_" }) + @("", "## Included files", "") + ($included | ForEach-Object { "- ``$_``" })
  [IO.File]::WriteAllLines((Join-Path $staging "AUDIT_MANIFEST.md"), $manifest, [Text.UTF8Encoding]::new($false))
  $metadata = [ordered]@{ commit = "$commit"; branch = "$branch"; dirty = $dirty; sha256 = $hashes }
  [IO.File]::WriteAllText((Join-Path $staging "AUDIT_CHECKSUMS.json"), ($metadata | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))

  if (Test-Path -LiteralPath $OutputPath) { Remove-Item -LiteralPath $OutputPath -Force }
  # .NET Framework on Windows may otherwise emit backslash entry names, which
  # Linux extracts as literal filenames rather than directory trees.
  $archive = [IO.Compression.ZipFile]::Open($OutputPath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in Get-ChildItem -LiteralPath $staging -Recurse -File -Force | Sort-Object FullName) {
      $entryName = $file.FullName.Substring($staging.Length).TrimStart([char[]]@("\", "/")).Replace("\", "/")
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal)
    }
  } finally { $archive.Dispose() }
  Write-Output $OutputPath
} finally {
  if (-not $KeepStaging -and (Test-Path -LiteralPath $staging)) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
