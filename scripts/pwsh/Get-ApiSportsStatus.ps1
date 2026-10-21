#Requires -Version 7.2
<#
.SYNOPSIS
    Mostra plano, cota diária usada/restante e assinatura de cada uma das 12 APIs da api-sports.

.DESCRIPTION
    Usa o endpoint /status de cada API. Segundo a documentação da api-sports, /status não é contabilizado
    na cota diária — confirme na issue de validação do plano gratuito (S1.3) antes de agendar este script.
    A chave é lida de $env:APISPORTS_KEY (nunca passe a chave na linha de comando nem a versione).

.EXAMPLE
    $env:APISPORTS_KEY = '<sua chave>'; ./scripts/pwsh/Get-ApiSportsStatus.ps1 | Format-Table
#>
[CmdletBinding()]
param(
    [string[]] $Sport = @('football', 'afl', 'baseball', 'basketball', 'formula-1', 'handball', 'hockey', 'mma', 'nba', 'american-football', 'rugby', 'volleyball')
)

$ErrorActionPreference = 'Stop'
if (-not $env:APISPORTS_KEY) { throw 'Defina $env:APISPORTS_KEY.' }

$hosts = @{
    'football'          = 'https://v3.football.api-sports.io'
    'afl'               = 'https://v1.afl.api-sports.io'
    'baseball'          = 'https://v1.baseball.api-sports.io'
    'basketball'        = 'https://v1.basketball.api-sports.io'
    'formula-1'         = 'https://v1.formula-1.api-sports.io'
    'handball'          = 'https://v1.handball.api-sports.io'
    'hockey'            = 'https://v1.hockey.api-sports.io'
    'mma'               = 'https://v1.mma.api-sports.io'
    'nba'               = 'https://v2.nba.api-sports.io'
    'american-football' = 'https://v1.american-football.api-sports.io'
    'rugby'             = 'https://v1.rugby.api-sports.io'
    'volleyball'        = 'https://v1.volleyball.api-sports.io'
}

foreach ($s in $Sport) {
    $base = $hosts[$s]
    if (-not $base) { Write-Warning "Esporte desconhecido: $s"; continue }
    try {
        $r = Invoke-RestMethod -Uri "$base/status" -Headers @{ 'x-apisports-key' = $env:APISPORTS_KEY } -TimeoutSec 20
        $resp = $r.response
        [pscustomobject]@{
            sport       = $s
            plan        = $resp.subscription.plan
            active      = $resp.subscription.active
            end         = $resp.subscription.end
            used_today  = $resp.requests.current
            limit_day   = $resp.requests.limit_day
            remaining   = if ($resp.requests.limit_day) { $resp.requests.limit_day - $resp.requests.current } else { $null }
            errors      = ($r.errors | ConvertTo-Json -Compress)
        }
    }
    catch {
        [pscustomobject]@{ sport = $s; plan = $null; active = $null; end = $null; used_today = $null; limit_day = $null; remaining = $null; errors = $_.Exception.Message }
    }
}
