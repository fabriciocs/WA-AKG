#requires -Version 5.1
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$plugin = Join-Path $root '.plugin-build\conectaflow-chatgpt'
$manifest = Join-Path $plugin 'plugin.json'
$assets = Join-Path $plugin 'assets'
if (!(Test-Path -LiteralPath $manifest)) { throw 'Manifesto ConectaFlow ausente.' }
$metadata = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
$null = Get-Content -LiteralPath (Join-Path $plugin 'mcp.json') -Raw | ConvertFrom-Json
if (!(Test-Path -LiteralPath $assets)) { New-Item -ItemType Directory -Path $assets | Out-Null }
@('conectaflow-mark.svg', 'conectaflow-wordmark.svg', 'conectaflow-favicon.svg', 'conectaflow-social.svg', 'conectaflow-social.png', 'conectaflow-icon-192.png', 'conectaflow-icon-512.png') | ForEach-Object {
  $source = Join-Path (Join-Path $root 'public\brand') $_
  if (!(Test-Path -LiteralPath $source)) { throw "Asset obrigatório ausente: $_" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $assets $_) -Force
}
$zip = Join-Path $root ('conectaflow-chatgpt-' + $metadata.version + '.zip')
if (Test-Path -LiteralPath $zip) { throw "Pacote já existe; preservado sem sobrescrita: $zip" }
Compress-Archive -LiteralPath $plugin -DestinationPath $zip -CompressionLevel Optimal
Add-Type -AssemblyName System.IO.Compression.FileSystem
$entryNames = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
  $entries = @($entryNames.Entries | ForEach-Object { $_.FullName })
  if (!($entries -match 'plugin\.json$') -or !($entries -match 'mcp\.json$') -or !($entries -match 'conectaflow-mark\.svg$')) { throw 'ZIP incompleto.' }
} finally { $entryNames.Dispose() }
Write-Output "PACKAGE=$zip"
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead($zip)
try { $hash = ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '') }
finally { $stream.Dispose(); $sha256.Dispose() }
Write-Output "SHA256=$hash"
Write-Output "FILES=$($entries.Count)"
