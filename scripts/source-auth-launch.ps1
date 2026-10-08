param([Parameter(Mandatory=$true)][string]$Handoff)
$ErrorActionPreference = 'Stop'
if ($Handoff -notmatch '^career-unified-auth://auth/?\?id=source-auth-[a-f0-9-]{36}&ticket=[a-f0-9]{64}&port=[0-9]{2,5}$') { throw 'Invalid authentication handoff.' }
$handoffParts = [regex]::Match($Handoff, 'id=(source-auth-[a-f0-9-]{36})&ticket=([a-f0-9]{64})&port=([0-9]{2,5})')
$handoffPort = [int]$handoffParts.Groups[3].Value
if ($handoffPort -lt 1 -or $handoffPort -gt 65535) { throw 'Invalid authentication port.' }
function Send-LauncherFailure([string]$FailureCode) {
  try {
    $endpoint = 'http://127.0.0.1:' + $handoffPort + '/api/connections/handoff/' + $handoffParts.Groups[1].Value + '/event'
    $headers = @{ Authorization = ('Bearer ' + $handoffParts.Groups[2].Value) }
    $body = @{ event = 'FAILED'; code = $FailureCode } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri $endpoint -Method Post -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 5 -MaximumRedirection 0 | Out-Null
  } catch { }
}
try {
  $projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
  Set-Location -LiteralPath $projectRoot
  $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { Send-LauncherFailure 'NODE_NOT_FOUND'; exit 1 }
  & $nodeCommand.Source (Join-Path $projectRoot 'scripts\source-auth-runner.mjs') $Handoff
  if ($LASTEXITCODE -ne 0) { Send-LauncherFailure 'RUNNER_START_FAILED'; exit 1 }
} catch { Send-LauncherFailure 'PROTOCOL_HANDLER_FAILED'; exit 1 }
