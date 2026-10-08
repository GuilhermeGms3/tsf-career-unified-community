$ErrorActionPreference = "Stop"
$extensionPath = Join-Path $PSScriptRoot "browser-extension"

if (-not (Test-Path (Join-Path $extensionPath "manifest.json"))) {
  throw "A extensao nao foi encontrada."
}

Start-Process "chrome://extensions"
Start-Process explorer.exe -ArgumentList $extensionPath

Write-Host ""
Write-Host "Ative o Modo do desenvolvedor, clique em Carregar sem compactacao e escolha:"
Write-Host $extensionPath
Write-Host ""
Write-Host "Isso e feito uma unica vez. A extensao preenche campos, mas nunca envia candidaturas."
