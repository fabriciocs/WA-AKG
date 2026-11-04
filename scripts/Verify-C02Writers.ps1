# Windows PowerShell 5.1. Inventario estatico, sem acesso a banco ou rede.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$scopes = @('src\modules', 'src\server', 'src\app\dashboard', 'src\lib', 'mcp\wa-akg-mcp\src', 'scripts')
$sourceTypes = @('.ts', '.tsx', '.mjs', '.js', '.cjs')
$pattern = '(?i)\b(?:prisma|tx|transaction)\.\w+\.(?:create|update|upsert|delete|createMany|updateMany|deleteMany)\s*\(|\$(?:executeRaw|queryRaw)|\b(?:sendMessage|fetch|registerTool)\s*\(|\.emit\s*\('
$results = New-Object System.Collections.ArrayList
foreach ($scope in $scopes) {
    $directory = Join-Path $root $scope
    if (-not (Test-Path $directory -PathType Container)) { continue }
    $files = @(Get-ChildItem -LiteralPath $directory -Recurse -File |
        Where-Object { $_.Extension -in $sourceTypes -and $_.FullName -notmatch '[\\/](?:node_modules|__tests__|\.next|coverage)[\\/]' })
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
        foreach ($match in @(Select-String -LiteralPath $file.FullName -Pattern $pattern -AllMatches)) {
            foreach ($hit in $match.Matches) {
                [void]$results.Add([pscustomobject]@{ Path = $relative; Line = $match.LineNumber; Sink = $hit.Value })
            }
        }
    }
}
$ordered = @($results | Sort-Object Path, Line, Sink)
$fileCount = @($ordered | Select-Object -ExpandProperty Path -Unique).Count
$sha = (& git -C $root rev-parse HEAD).Trim()
$lines = New-Object 'System.Collections.Generic.List[string]'
[void]$lines.Add('# C02 - Escritores e efeitos fora de rotas HTTP')
[void]$lines.Add('')
[void]$lines.Add(('Base Git SHA `' + $sha + '`.'))
[void]$lines.Add('Status: INVENTARIO_ESTATICO_WIP. Inclui alteracoes locais ainda nao commitadas; nao prova isolamento nem cobre chamadas indiretas.')
[void]$lines.Add(('Marcadores: ' + $ordered.Count + '; arquivos distintos: ' + $fileCount + '.'))
[void]$lines.Add('')
[void]$lines.Add('| Arquivo | Linha | Marcador | Revisao |')
[void]$lines.Add('|---|---:|---|---|')
foreach ($item in $ordered) {
    $state = 'PENDING_MANUAL_REVIEW'
    if ($item.Path -eq 'src/modules/messaging/outbound-message.service.ts') { $state = 'GUARD_TESTED_SYNTHETIC_INTEGRATION_PENDING' }
    if ($item.Path -eq 'src/lib/cron.ts' -or $item.Path -like 'src/app/dashboard/*/actions.ts' -or $item.Path -eq 'src/server/socket.ts') { $state = 'PARTIAL_SOURCE_REVIEW' }
    [void]$lines.Add(('| `' + $item.Path + '` | ' + $item.Line + ' | `' + $item.Sink + '` | ' + $state + ' |'))
}

[void]$lines.Add('')
[void]$lines.Add('## Revisao manual e limites')
[void]$lines.Add('')
[void]$lines.Add('- Worker outbound: vinculo de tenant, usuario e sessao aplicado; exige testes de integracao antes de ativacao real.')
[void]$lines.Add('- Cron: filtros tenant-aware e claims identificados; revisar corrida, estado de tenant e filhos.')
[void]$lines.Add('- Server Actions: guards por sessao observados em chat e autoreply; validar consultas filhas.')
[void]$lines.Add('- Socket.IO: salas por tenant e revalidacao no envio; teste de rede usa Prisma simulado.')
[void]$lines.Add('- MCP: OAuth e grant por tenant; harness com duas replicas e backend sintetico.')
[void]$lines.Add('- Scripts de backfill/reparo: nunca aplicar a banco existente sem backup/restauracao e autorizacao.')
[void]$lines.Add('- Marcadores heuristicas nao abrangem aliases, transacoes dinamicas, todas as escritas em disco ou sinks indiretos.')
[void]$lines.Add('- Estado C02: PARTIAL. E2E Next.js + MySQL isolado e testes negativos de todos os escritores ainda pendentes.')
$output = Join-Path $root 'docs\C02_NON_HTTP_WRITERS.md'
$lines | Set-Content -LiteralPath $output -Encoding UTF8
Write-Output ('SHA=' + $sha)
Write-Output ('WRITER_MARKERS=' + $ordered.Count)
Write-Output ('WRITER_FILES=' + $fileCount)
Write-Output ('REPORT=' + $output)
