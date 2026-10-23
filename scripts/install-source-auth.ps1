param([ValidatePattern('^https://[a-zA-Z0-9.-]+\.ts\.net(?::[0-9]{1,5})?$')][string]$ServerOrigin)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$launcherPath = Join-Path $projectRoot 'scripts\source-auth-launch.ps1'
if (-not (Test-Path -LiteralPath $launcherPath)) { throw 'Source auth launcher not found.' }
$protocolPath = 'HKCU:\Software\Classes\career-unified-auth'
New-Item -Path $protocolPath -Force | Out-Null
Set-Item -Path $protocolPath -Value 'URL:Career Unified owned authentication'
New-ItemProperty -Path $protocolPath -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
New-Item -Path "$protocolPath\shell\open\command" -Force | Out-Null
$launcherCommand = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcherPath + '" "%1"'
if ($ServerOrigin) { $launcherCommand += ' -ServerOrigin "' + $ServerOrigin + '"' }
Set-Item -Path "$protocolPath\shell\open\command" -Value $launcherCommand
Write-Output 'Career Unified authentication launcher registered for this Windows user only.'
