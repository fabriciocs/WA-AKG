#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ProjectPath = 'C:\repos\WA-AKG',
    [int]$Port = 43000,
    [int]$StartupTimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$logDir = Join-Path $env:TEMP 'WA-AKG'
$stdoutLog = Join-Path $logDir 'server.stdout.log'
$stderrLog = Join-Path $logDir 'server.stderr.log'

try {
    if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) {
        throw "Pasta do projeto não encontrada: $ProjectPath"
    }
    $packagePath = Join-Path $ProjectPath 'package.json'
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        throw "package.json não encontrado em $ProjectPath"
    }
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    if (-not $package.scripts.dev) { throw 'O package.json não define scripts.dev.' }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'node.exe não foi encontrado no PATH.' }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd não foi encontrado no PATH.' }
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectPath 'node_modules') -PathType Container)) {
        throw 'node_modules não encontrado. Instale as dependências antes de iniciar.'
    }

    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) { throw "A porta $Port já está em uso pelo PID $($listener.OwningProcess). Nenhum processo foi encerrado." }

    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    Set-Content -LiteralPath $stdoutLog -Value '' -Encoding UTF8
    Set-Content -LiteralPath $stderrLog -Value '' -Encoding UTF8

    $cmd = Join-Path $env:WINDIR 'System32\cmd.exe'
    $arguments = '/d /s /c "npm run dev -- --hostname 127.0.0.1 --port ' + $Port + '"'
    $proc = Start-Process -FilePath $cmd -ArgumentList $arguments -WorkingDirectory $ProjectPath -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru

    Write-Host "Terminal dedicado iniciado. PID inicial: $($proc.Id)"
    Write-Host "Projeto: $ProjectPath"
    Write-Host "URL esperada: http://localhost:$Port"
    Write-Host "Log stdout: $stdoutLog"
    Write-Host "Log stderr: $stderrLog"

    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 750
        if ($proc.HasExited) { break }
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                $ready = $true
                Write-Host "HTTP respondeu com status $($response.StatusCode)." -ForegroundColor Green
                break
            }
        } catch { }
    }

    if (-not $ready) {
        Write-Warning "Não foi possível confirmar resposta HTTP em $StartupTimeoutSeconds segundos."
        Write-Host '--- stdout (final) ---'
        Get-Content -LiteralPath $stdoutLog -Tail 40 -ErrorAction SilentlyContinue
        Write-Host '--- stderr (final) ---'
        Get-Content -LiteralPath $stderrLog -Tail 40 -ErrorAction SilentlyContinue
        if ($proc.HasExited) {
            Write-Host "O processo terminou com código $($proc.ExitCode)."
            exit $proc.ExitCode
        }
        Write-Host 'O processo continua ativo; consulte os logs.'
        exit 1
    }

    Write-Host 'Inicialização HTTP confirmada. Login, banco e demais funcionalidades não foram validados.'
    exit 0
}
catch {
    Write-Error $_
    exit 1
}