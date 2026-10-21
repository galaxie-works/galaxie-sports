#Requires -Version 7.2
<#
.SYNOPSIS
    Espelha localmente todos os assets (logos, bandeiras, estádios, jogadores, técnicos, pilotos, lutadores...)
    referenciados nas respostas brutas da api-sports.

.DESCRIPTION
    Em vez de "adivinhar" IDs, o script varre as respostas JSON já espelhadas (schema raw) e extrai toda URL
    https://media.api-sports.io/... encontrada. Assim cobre os 12 esportes e qualquer tipo de imagem sem manter
    uma lista de padrões. As URLs de mídia não são chamadas à API de dados (não usam a chave nem a cota diária),
    mas a CDN tem limite de taxa — por isso o paralelismo é baixo e há atraso entre downloads.

    Saída:
      <Destination>/<caminho original>   ex.: assets/football/teams/121.png, assets/flags/br.svg
      <Destination>/manifest.csv         url, path, bytes, sha256, status, downloaded_at

    Execuções repetidas só baixam o que falta (idempotente). Use -Force para baixar tudo de novo.

.PARAMETER SourcePath
    Pasta com arquivos .json (envelopes da api-sports exportados do schema raw) — busca recursiva.

.PARAMETER UrlListPath
    Alternativa/complemento: arquivo texto com uma URL de mídia por linha.

.PARAMETER Destination
    Pasta de destino dos assets. Padrão: ./data/assets (ignorada pelo Git).

.PARAMETER ThrottleLimit
    Downloads simultâneos. Padrão 4.

.PARAMETER DelayMs
    Pausa por download em cada worker, para respeitar a CDN. Padrão 150 ms.

.PARAMETER DenylistPath
    Lista de bloqueio (URLs que o fornecedor serve erradas, ex.: o logo do Paulistão). Padrão:
    config/assets/denylist.yaml — a mesma do worker Node (pnpm --filter @galaxie/ingestor assets:mirror).

.NOTES
    Este script grava em disco (útil para inspeção e cópia manual). O worker Node (services/ingestor,
    assets:mirror) é o caminho agendado: grava no bucket S3 e preenche core.asset (storage_key, sha256,
    dimensões) para a API reescrever as URLs para o nosso CDN.

.EXAMPLE
    ./scripts/pwsh/Sync-ApiSportsAssets.ps1 -SourcePath ./data/raw -Destination ./data/assets

.EXAMPLE
    ./scripts/pwsh/Sync-ApiSportsAssets.ps1 -UrlListPath ./urls.txt -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]   $SourcePath,
    [string]   $UrlListPath,
    [string]   $Destination = (Join-Path (Get-Location) 'data/assets'),
    [ValidateRange(1, 16)] [int] $ThrottleLimit = 4,
    [ValidateRange(0, 10000)] [int] $DelayMs = 150,
    [ValidateRange(0, 10)] [int] $MaxRetries = 3,
    [string]   $DenylistPath = (Join-Path $PSScriptRoot '../../config/assets/denylist.yaml'),
    [switch]   $Force
)

$ErrorActionPreference = 'Stop'
if (-not $SourcePath -and -not $UrlListPath) {
    throw 'Informe -SourcePath (pasta de JSON) e/ou -UrlListPath (lista de URLs).'
}

$mediaPattern = 'https?:\\?/\\?/media(?:-\d+)?\.api-sports\.io(?:\\?/[A-Za-z0-9_\-\.]+)+'

# 1) Coletar URLs ----------------------------------------------------------------------------------
$urls = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

if ($SourcePath) {
    $files = Get-ChildItem -Path $SourcePath -Recurse -File -Include *.json, *.jsonl
    Write-Verbose "Varrendo $($files.Count) arquivos em $SourcePath"
    foreach ($file in $files) {
        $text = [System.IO.File]::ReadAllText($file.FullName)
        foreach ($m in [regex]::Matches($text, $mediaPattern)) {
            [void]$urls.Add(($m.Value -replace '\\/', '/'))
        }
    }
}
if ($UrlListPath) {
    Get-Content -Path $UrlListPath | Where-Object { $_ -match $mediaPattern } | ForEach-Object { [void]$urls.Add($_.Trim()) }
}

# Normaliza host (media-1, media-2 ... → media) para não baixar o mesmo arquivo duas vezes
$normalized = $urls | ForEach-Object { $_ -replace '^http://', 'https://' -replace '//media-\d+\.', '//media.' } | Sort-Object -Unique

# Lista de bloqueio: linhas "- url: https://media.api-sports.io/..." do YAML (sem depender de módulo YAML)
if ($DenylistPath -and (Test-Path -LiteralPath $DenylistPath)) {
    $denied = @(
        Select-String -LiteralPath $DenylistPath -Pattern '^\s*-?\s*url:\s*["'']?(https?://\S+?)["'']?\s*$' |
            ForEach-Object { $_.Matches[0].Groups[1].Value -replace '^http://', 'https://' -replace '//media-\d+\.', '//media.' }
    )
    if ($denied.Count) {
        $normalized = @($normalized | Where-Object { $_ -notin $denied })
        Write-Verbose "Bloqueadas pela lista: $($denied -join ', ')"
    }
}
Write-Host "URLs de mídia únicas: $($normalized.Count)"

# 2) Planejar ---------------------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$manifest = Join-Path $Destination 'manifest.csv'
$previous = if ((Test-Path $manifest) -and -not $Force) { @(Import-Csv $manifest) } else { @() }
# 404 já registrado não é tentado de novo (use -Force para reavaliar)
$knownMissing = [System.Collections.Generic.HashSet[string]]::new([string[]]@($previous | Where-Object status -eq 'not_found' | ForEach-Object url))
$plan = foreach ($u in $normalized) {
    $relative = ([uri]$u).AbsolutePath.TrimStart('/')
    $target = Join-Path $Destination $relative
    if ($Force -or (-not (Test-Path -LiteralPath $target) -and -not $knownMissing.Contains($u))) {
        [pscustomobject]@{ Url = $u; Path = $target; Relative = $relative }
    }
}
$plan = @($plan)
Write-Host "A baixar: $($plan.Count) (já existentes ou 404 conhecidos: $($normalized.Count - $plan.Count))"
if ($plan.Count -eq 0) { Write-Host 'Nada a baixar.'; return }

if (-not $PSCmdlet.ShouldProcess("$($plan.Count) arquivos", "Download para $Destination")) { return }

# 3) Baixar em paralelo -----------------------------------------------------------------------------
$results = $plan | ForEach-Object -ThrottleLimit $ThrottleLimit -Parallel {
    $item = $_
    $dir = Split-Path -Parent $item.Path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

    $status = 'error'; $bytes = 0; $hash = $null; $attempt = 0
    while ($attempt -le $using:MaxRetries) {
        try {
            $tmp = "$($item.Path).part"
            Invoke-WebRequest -Uri $item.Url -OutFile $tmp -UserAgent 'galaxie-sports-asset-mirror/1.0' -TimeoutSec 30
            Move-Item -LiteralPath $tmp -Destination $item.Path -Force
            $bytes = (Get-Item -LiteralPath $item.Path).Length
            $hash = (Get-FileHash -LiteralPath $item.Path -Algorithm SHA256).Hash.ToLowerInvariant()
            $status = 'ok'
            break
        }
        catch {
            $code = $_.Exception.Response.StatusCode.value__
            if ($code -eq 404) { $status = 'not_found'; break }
            $attempt++
            # 429/5xx: backoff exponencial
            Start-Sleep -Milliseconds ([math]::Min(30000, 500 * [math]::Pow(2, $attempt)))
        }
        finally {
            if (Test-Path -LiteralPath "$($item.Path).part") { Remove-Item -LiteralPath "$($item.Path).part" -Force }
        }
    }
    Start-Sleep -Milliseconds $using:DelayMs
    [pscustomobject]@{
        url = $item.Url; path = $item.Relative; bytes = $bytes; sha256 = $hash; status = $status
        downloaded_at = (Get-Date).ToUniversalTime().ToString('o')
    }
}

# 4) Manifesto -------------------------------------------------------------------------------------
$merged = @($previous | Where-Object { $_.url -notin $results.url }) + @($results)
$merged | Sort-Object url | Export-Csv -Path $manifest -NoTypeInformation -Encoding utf8

$summary = $results | Group-Object status | ForEach-Object { "$($_.Name)=$($_.Count)" }
Write-Host "Concluído: $($summary -join ', '). Manifesto: $manifest"
