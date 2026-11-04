#requires -version 5.1
[CmdletBinding()]
param(
    [string]$CaddyfilePath = 'C:\ProgramData\CaddyWebGateway\Caddyfile',
    [string]$PublicHost = 'gauntlet-fruit-discount.ngrok-free.dev',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
if ($PublicHost -notmatch '^[a-zA-Z0-9.-]+$') { throw 'Invalid public hostname.' }
if (-not (Test-Path -LiteralPath $CaddyfilePath -PathType Leaf)) { throw 'Caddyfile not found.' }
$caddy = (Get-Command caddy -ErrorAction Stop).Source
$original = [System.IO.File]::ReadAllText($CaddyfilePath)
$marker = '@wa_akg_public_oauth_authorize_alias'
$metadataMarker = '@wa_akg_public_oauth_metadata_insert'
$anchor = '# WA-AKG is built at the root and mounted publicly under /wa-akg.'
if (-not $original.Contains($anchor)) { throw 'Expected Caddy anchor is missing; no changes made.' }

$alias = @"
    # Compatibility for clients that fall back to /authorize instead of discovery.
    # Scope strictly to the WA-AKG public host: leave other root handlers unchanged.
    @wa_akg_public_oauth_authorize_alias {
        host $PublicHost
        path /authorize
    }
    handle @wa_akg_public_oauth_authorize_alias {
        redir * /wa-akg/api/oauth/authorize{?query} 307
    }
    # Non-browser OAuth client fallback endpoints; preserve POST method and body.
    @wa_akg_public_oauth_protocol_alias {
        host $PublicHost
        path /token /register /revoke /introspect
    }
    handle @wa_akg_public_oauth_protocol_alias {
        rewrite * /api/oauth{uri}
        reverse_proxy http://127.0.0.1:43000 {
            header_up X-Forwarded-Prefix /wa-akg
            header_up X-Forwarded-Host $PublicHost
            header_up X-Forwarded-Proto https
        }
    }

"@
if ($original.Contains($marker) -and $original.Contains($metadataMarker)) {
    Write-Output 'ALREADY_PRESENT: authorization and RFC 8414 metadata aliases exist.'
    exit 0
}
if ($original.Contains($marker)) { $alias = '' }
$metadata = @"
    # RFC 8414 issuer with a path: /.well-known/oauth-authorization-server/wa-akg
    # Must return OAuth JSON, not the root Caddy health page.
    @wa_akg_public_oauth_metadata_insert {
        host $PublicHost
        path /.well-known/oauth-authorization-server/wa-akg
    }
    handle @wa_akg_public_oauth_metadata_insert {
        rewrite * /.well-known/oauth-authorization-server
        reverse_proxy http://127.0.0.1:43000 {
            header_up X-Forwarded-Prefix /wa-akg
            header_up X-Forwarded-Host $PublicHost
            header_up X-Forwarded-Proto https
        }
    }
    # RFC 9728 path-based MCP protected resource discovery.
    @wa_akg_public_oauth_resource_insert {
        host $PublicHost
        path /.well-known/oauth-protected-resource/wa-akg/mcp
    }
    handle @wa_akg_public_oauth_resource_insert {
        rewrite * /.well-known/oauth-protected-resource
        reverse_proxy http://127.0.0.1:43000 {
            header_up X-Forwarded-Prefix /wa-akg
            header_up X-Forwarded-Host $PublicHost
            header_up X-Forwarded-Proto https
        }
    }

"@
if ($original.Contains($metadataMarker)) { $metadata = '' }
$target = $original.Replace($anchor, $alias + $metadata + '    ' + $anchor)
if ($target -eq $original) { throw 'No replacement performed.' }
$session = Join-Path $env:LOCALAPPDATA ('CaddyWebGateway\oauth-alias-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -Path $session -ItemType Directory -Force | Out-Null
$candidate = Join-Path $session 'Caddyfile.candidate'
$backup = Join-Path $session 'Caddyfile.backup'
$stderr = Join-Path $session 'adapt.stderr.log'
$encoding = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($candidate, $target, $encoding)
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue' # PowerShell 5.1 maps native stderr warnings to error records.
try {
    & $caddy adapt --config $candidate --adapter caddyfile 1>$null 2>$stderr
    $adaptExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousPreference }
Write-Output ('ADAPT_EXIT=' + $adaptExit)
Write-Output ('CANDIDATE=' + $candidate)
if ($adaptExit -ne 0) { throw 'Candidate failed caddy adapt; original preserved.' }
if (-not $Apply) { Write-Output 'STATUS=PROPOSED (dry run; live Caddyfile untouched)'; exit 0 }

# Check for user changes since candidate generation and retain a byte-for-byte backup.
$current = [System.IO.File]::ReadAllText($CaddyfilePath)
if ($current -cne $original) { throw 'Caddyfile changed during plan; original preserved.' }
Copy-Item -LiteralPath $CaddyfilePath -Destination $backup -ErrorAction Stop
try {
    [System.IO.File]::WriteAllText($CaddyfilePath, $target, $encoding)
    $reloadStderr = Join-Path $session 'reload.stderr.log'
    $ErrorActionPreference = 'Continue'
    try {
        & $caddy reload --config $CaddyfilePath --adapter caddyfile 1>$null 2>$reloadStderr
        $reloadExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($reloadExit -ne 0) { throw 'Caddy reload failed.' }
    # Inert values only. Never persist an actual OAuth state, code, verifier or token.
    $request = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:8080/authorize?response_type=code&state=probe-only')
    $request.Host = $PublicHost
    $request.AllowAutoRedirect = $false
    $request.Timeout = 5000
    $response = $null
    try { $response = $request.GetResponse() }
    catch [System.Net.WebException] {
        $response = $_.Exception.Response
        if (-not $response) { throw }
    }
    try {
        $status = [int]$response.StatusCode
        $location = $response.Headers['Location']
        Write-Output ('REDIRECT_STATUS=' + $status)
        Write-Output ('REDIRECT_LOCATION=' + $location)
        if ($status -ne 307 -or $location -ne '/wa-akg/api/oauth/authorize?response_type=code&state=probe-only') {
            throw 'OAuth alias redirect verification failed.'
        }
    } finally { $response.Close() }
    Write-Output ('BACKUP=' + $backup)
    Write-Output 'STATUS=VERIFIED (live 307 checked; other OAuth steps require separate validation)'
} catch {
    Write-Output ('ERROR=' + $_.Exception.Message)
    try {
        Copy-Item -LiteralPath $backup -Destination $CaddyfilePath -Force -ErrorAction Stop
        $ErrorActionPreference = 'Continue'
        try {
            & $caddy reload --config $CaddyfilePath --adapter caddyfile 1>$null 2>$null
            $rollbackExit = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousPreference }
        Write-Output ('ROLLBACK_RELOAD_EXIT=' + $rollbackExit)
    } catch {
        Write-Output ('ROLLBACK_ERROR=' + $_.Exception.Message)
    }
    throw
}
