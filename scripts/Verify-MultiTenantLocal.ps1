# Requires Windows PowerShell 5.1. All checks are local and do not migrate or delete data.
[CmdletBinding()]
param(
    [switch]$SkipMcp,
    [switch]$SkipPrismaGenerate
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

$sessionId = 'tenant-validation-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$root = Join-Path $repoRoot ('.remote-desktop\sessions\' + $sessionId)
$raw = Join-Path $root 'raw'
$evidence = Join-Path $root 'evidence'
New-Item -ItemType Directory -Path $raw, $evidence -Force | Out-Null

$checks = New-Object System.Collections.ArrayList
function Invoke-Check {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $executable = (Get-Command $Command -ErrorAction Stop).Source
    $outPath = Join-Path $raw ($Id + '.stdout.log')
    $errPath = Join-Path $raw ($Id + '.stderr.log')
    $started = Get-Date
    $process = Start-Process -FilePath $executable -ArgumentList $Arguments -WorkingDirectory $repoRoot -NoNewWindow -Wait -PassThru -RedirectStandardOutput $outPath -RedirectStandardError $errPath
    $result = [ordered]@{
        id = $Id
        command = $Command
        arguments = $Arguments
        startedAt = $started.ToUniversalTime().ToString('o')
        finishedAt = (Get-Date).ToUniversalTime().ToString('o')
        exitCode = [int]$process.ExitCode
        status = $(if ($process.ExitCode -eq 0) { 'TESTED' } else { 'FAILED' })
        stdout = $outPath
        stderr = $errPath
    }
    [void]$checks.Add($result)
    Write-Output ('{0}: {1} (exit={2})' -f $Id, $result.status, $process.ExitCode)
}

Write-Output ('SESSION_ID=' + $sessionId)
Write-Output ('BRANCH=' + (git branch --show-current))
Write-Output ('HEAD=' + (git rev-parse --short HEAD))

Invoke-Check -Id 'prisma-validate' -Command 'npx.cmd' -Arguments @('--no-install', 'prisma', 'validate')
if (-not $SkipPrismaGenerate) {
    Invoke-Check -Id 'prisma-generate' -Command 'npx.cmd' -Arguments @('--no-install', 'prisma', 'generate')
}
Invoke-Check -Id 'typecheck' -Command 'npx.cmd' -Arguments @('--no-install', 'tsc', '--noEmit')
Invoke-Check -Id 'eslint' -Command 'npm.cmd' -Arguments @('run', 'lint')
Invoke-Check -Id 'tests' -Command 'npm.cmd' -Arguments @('test')
if (-not $SkipMcp) {
    Invoke-Check -Id 'mcp-check' -Command 'npm.cmd' -Arguments @('run', 'mcp:check')
    Invoke-Check -Id 'mcp-tests' -Command 'npm.cmd' -Arguments @('run', 'mcp:test')
}

$failures = @($checks | Where-Object { $_.exitCode -ne 0 })
$report = [ordered]@{
    sessionId = $sessionId
    branch = (git branch --show-current)
    commit = (git rev-parse HEAD)
    status = $(if ($failures.Count -eq 0) { 'TESTED' } else { 'FAILED' })
    checks = $checks
    failed = $failures.Count
    limitations = @('No database migrations, production operations, live messaging, browser automation or HTTP integration tests were executed.')
}
$report | ConvertTo-Json -Depth 6 | Out-File -FilePath (Join-Path $evidence 'validation.json') -Encoding utf8
Write-Output ('STATUS=' + $report.status)
Write-Output ('FAILED=' + $report.failed)
Write-Output ('LOG_ROOT=' + $raw)
Write-Output ('EVIDENCE_ROOT=' + $evidence)
if ($failures.Count -ne 0) { exit 1 }
