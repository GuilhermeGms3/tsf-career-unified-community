[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

try {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $outputPath = Join-Path $desktop "career-unified-code-$timestamp.zip"
  $exportScript = Join-Path $PSScriptRoot "export-audit.ps1"

  $zipPath = & $exportScript -OutputPath $outputPath
  Start-Process explorer.exe -ArgumentList "/select,`"$zipPath`""
  [Windows.Forms.MessageBox]::Show(
    "Código compactado com segurança em:`n$zipPath",
    "Career Unified",
    [Windows.Forms.MessageBoxButtons]::OK,
    [Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
} catch {
  [Windows.Forms.MessageBox]::Show(
    "Não foi possível compactar o projeto.`n`n$($_.Exception.Message)",
    "Career Unified",
    [Windows.Forms.MessageBoxButtons]::OK,
    [Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}
