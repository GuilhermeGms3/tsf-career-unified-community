[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$source = (Resolve-Path -LiteralPath $Path).Path
$validator = Join-Path $PSScriptRoot "validate-audit-export.ps1"
$cases = @(
  @{ Name = "secret"; Entry = ".env"; Text = "SYNTHETIC_SECRET=not-a-real-secret"; Error = "proibido no ZIP" },
  @{ Name = "document"; Entry = "tests/personal.pdf"; Text = "not a real PDF"; Error = "proibido no ZIP" },
  @{ Name = "tamper"; Entry = "README.md"; Text = "altered source"; Error = "Hash divergente" },
  @{ Name = "traversal"; Entry = "../outside.txt"; Text = "blocked"; Error = "Caminho inseguro" },
  @{ Name = "nonportable"; Entry = "scripts\nonportable.mjs"; Text = "blocked"; Error = "Separador nao portavel" },
  @{ Name = "runtime-cache"; Entry = "src/intelligence/cache/runtime.json"; Text = "{}"; Error = "proibido no ZIP" },
  @{ Name = "missing-runtime-module"; Entry = "src/intelligence/cache/intelligence-cache.mjs"; Remove = $true; Error = "ausente" }
)

foreach ($case in $cases) {
  $copy = Join-Path ([IO.Path]::GetTempPath()) "tsf-audit-$([guid]::NewGuid()).zip"
  try {
    Copy-Item -LiteralPath $source -Destination $copy
    $archive = [IO.Compression.ZipFile]::Open($copy, [IO.Compression.ZipArchiveMode]::Update)
    try {
      $existing = $archive.GetEntry($case.Entry)
      if ($existing) { $existing.Delete() }
      if (-not $case["Remove"]) {
        $entry = $archive.CreateEntry($case.Entry)
        $writer = [IO.StreamWriter]::new($entry.Open())
        try { $writer.Write($case.Text) } finally { $writer.Dispose() }
      }
    } finally { $archive.Dispose() }

    $failure = ""
    try { & $validator -Path $copy | Out-Null } catch { $failure = $_.Exception.Message }
    if (-not $failure -or $failure -notmatch $case.Error) {
      throw "Caso $($case.Name) nao bloqueado corretamente: $failure"
    }
    Write-Output "PASS: audit rejects $($case.Name)"
  } finally {
    if (Test-Path -LiteralPath $copy) { Remove-Item -LiteralPath $copy -Force }
  }
}
