[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectDir = [IO.Path]::GetFullPath($PSScriptRoot)
$MinecraftDir = [IO.Path]::GetFullPath((Join-Path $ProjectDir '..\..'))
$InstanceDir = [IO.Path]::GetFullPath((Join-Path $MinecraftDir '..'))
$MmcPack = Join-Path $InstanceDir 'mmc-pack.json'
$PatchDir = Join-Path $InstanceDir 'patches'
$LibraryDir = Join-Path $InstanceDir 'libraries'
$PatchTarget = Join-Path $PatchDir 'dev.y100d.earlyloading.json'
$LibraryTarget = Join-Path $LibraryDir 'y100d-early-loading.jar'
$Config = Join-Path $MinecraftDir 'config\fml.toml'
$Utf8NoBom = [Text.UTF8Encoding]::new($false)

if (Get-Process -Name prismlauncher -ErrorAction SilentlyContinue) {
    throw 'Close Prism Launcher before installing; otherwise it can overwrite mmc-pack.json.'
}
if (!(Test-Path -LiteralPath $MmcPack) -or !(Test-Path -LiteralPath $Config)) {
    throw "This script must be run from the 1.21.1 instance repository."
}

& (Join-Path $ProjectDir 'build.ps1')
if ($LASTEXITCODE -ne 0) {
    throw 'Build failed; installation was not changed.'
}

New-Item -ItemType Directory -Path $PatchDir, $LibraryDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $ProjectDir 'component\dev.y100d.earlyloading.json') -Destination $PatchTarget -Force
Copy-Item -LiteralPath (Join-Path $ProjectDir 'dist\y100d-early-loading.jar') -Destination $LibraryTarget -Force

$Pack = Get-Content -Raw -LiteralPath $MmcPack | ConvertFrom-Json
$Component = [pscustomobject][ordered]@{
    cachedName = 'Y100D Early Loading'
    cachedRequires = @(
        [pscustomobject][ordered]@{
            uid = 'net.neoforged'
            equals = '21.1.233'
        }
    )
    cachedVersion = '1.0.0-fml4.0.42'
    uid = 'dev.y100d.earlyloading'
}
$Pack.components = @($Pack.components | Where-Object { $_.uid -ne 'dev.y100d.earlyloading' }) + $Component
$PackJson = $Pack | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText($MmcPack, "$PackJson`n", $Utf8NoBom)

$ConfigText = [IO.File]::ReadAllText($Config)
if ($ConfigText -notmatch '(?m)^earlyWindowProvider\s*=') {
    throw 'earlyWindowProvider was not found in config/fml.toml.'
}
$ConfigText = [Text.RegularExpressions.Regex]::Replace(
    $ConfigText,
    '(?m)^earlyWindowProvider\s*=\s*"[^"]*"\s*$',
    'earlyWindowProvider = "y100danimated"')
[IO.File]::WriteAllText($Config, $ConfigText, $Utf8NoBom)

Write-Output "Installed Y100D Early Loading into $InstanceDir"
Write-Output 'Provider set to y100danimated; it will activate on the next game start.'
