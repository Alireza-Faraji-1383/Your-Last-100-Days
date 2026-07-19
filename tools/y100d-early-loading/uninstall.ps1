[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectDir = [IO.Path]::GetFullPath($PSScriptRoot)
$MinecraftDir = [IO.Path]::GetFullPath((Join-Path $ProjectDir '..\..'))
$InstanceDir = [IO.Path]::GetFullPath((Join-Path $MinecraftDir '..'))
$MmcPack = Join-Path $InstanceDir 'mmc-pack.json'
$PatchTarget = Join-Path $InstanceDir 'patches\dev.y100d.earlyloading.json'
$LibraryTarget = Join-Path $InstanceDir 'libraries\y100d-early-loading.jar'
$Config = Join-Path $MinecraftDir 'config\fml.toml'
$Utf8NoBom = [Text.UTF8Encoding]::new($false)

if (Get-Process -Name prismlauncher -ErrorAction SilentlyContinue) {
    throw 'Close Prism Launcher before uninstalling; otherwise it can overwrite mmc-pack.json.'
}

$Pack = Get-Content -Raw -LiteralPath $MmcPack | ConvertFrom-Json
$Pack.components = @($Pack.components | Where-Object { $_.uid -ne 'dev.y100d.earlyloading' })
$PackJson = $Pack | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText($MmcPack, "$PackJson`n", $Utf8NoBom)

foreach ($Target in @($PatchTarget, $LibraryTarget)) {
    $ResolvedParent = [IO.Path]::GetFullPath((Split-Path -Parent $Target))
    if (!$ResolvedParent.StartsWith($InstanceDir, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a file outside the instance: $Target"
    }
    if (Test-Path -LiteralPath $Target) {
        Remove-Item -LiteralPath $Target -Force
    }
}

$ConfigText = [IO.File]::ReadAllText($Config)
$ConfigText = [Text.RegularExpressions.Regex]::Replace(
    $ConfigText,
    '(?m)^earlyWindowProvider\s*=\s*"[^"]*"\s*$',
    'earlyWindowProvider = "fmlearlywindow"')
[IO.File]::WriteAllText($Config, $ConfigText, $Utf8NoBom)

Write-Output 'Removed Y100D Early Loading and restored the stock NeoForge provider.'
