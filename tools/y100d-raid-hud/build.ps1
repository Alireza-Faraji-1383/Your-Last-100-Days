$ErrorActionPreference = "Stop"

$toolRoot = $PSScriptRoot
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $toolRoot "..\..")).Path
$prismRoot = (Resolve-Path -LiteralPath (Join-Path $workspaceRoot "..\..\..")).Path
$javaBin = Join-Path $prismRoot "java\java-runtime-delta\bin"
$libraryRoot = Join-Path $prismRoot "libraries"
$buildRoot = Join-Path $toolRoot "build"
$classRoot = Join-Path $buildRoot "classes"
$stageRoot = Join-Path $buildRoot "stage"
$outputJar = Join-Path $workspaceRoot "mods\y100d-raid-hud-1.0.0+mc1.21.1-neoforge.jar"

$resolvedBuild = [System.IO.Path]::GetFullPath($buildRoot)
$resolvedTool = [System.IO.Path]::GetFullPath($toolRoot)
if (-not $resolvedBuild.StartsWith($resolvedTool, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clear a build path outside the HUD tool directory."
}
if (Test-Path -LiteralPath $resolvedBuild) {
    Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
}

New-Item -ItemType Directory -Path $classRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

$classpath = @(
    (Join-Path $libraryRoot "net\minecraft\client\1.21.1-20240808.144430\client-1.21.1-20240808.144430-srg.jar"),
    (Join-Path $libraryRoot "net\neoforged\neoforge\21.1.233\neoforge-21.1.233-universal.jar"),
    (Join-Path $libraryRoot "net\neoforged\bus\8.0.5\bus-8.0.5.jar"),
    (Join-Path $libraryRoot "net\neoforged\fancymodloader\loader\4.0.42\loader-4.0.42.jar"),
    (Join-Path $libraryRoot "net\neoforged\mergetool\2.0.0\mergetool-2.0.0-api.jar"),
    (Join-Path $libraryRoot "com\mojang\brigadier\1.3.10\brigadier-1.3.10.jar")
) -join ";"

$sourceFile = Join-Path $toolRoot "src\main\java\dev\alireza\y100d\raidhud\RaidHudMod.java"
& (Join-Path $javaBin "javac.exe") `
    --release 21 `
    -encoding UTF-8 `
    -classpath $classpath `
    -d $classRoot `
    $sourceFile
if ($LASTEXITCODE -ne 0) {
    throw "javac failed with exit code $LASTEXITCODE"
}

Copy-Item -LiteralPath (Join-Path $classRoot "dev") -Destination $stageRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $toolRoot "src\main\resources\META-INF") -Destination $stageRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $toolRoot "src\main\resources\pack.mcmeta") -Destination $stageRoot -Force

$textureTarget = Join-Path $stageRoot "assets\y100d_raid_hud\textures\gui"
New-Item -ItemType Directory -Path $textureTarget -Force | Out-Null
Copy-Item `
    -LiteralPath (Join-Path $workspaceRoot "kubejs\assets\kubejs\textures\gui\raid_hud_frame_wide.png") `
    -Destination (Join-Path $textureTarget "raid_hud_frame_wide.png") `
    -Force
Copy-Item `
    -LiteralPath (Join-Path $workspaceRoot "kubejs\assets\kubejs\textures\gui\day_moon_bg.png") `
    -Destination (Join-Path $textureTarget "day_moon_bg.png") `
    -Force
Copy-Item `
    -LiteralPath (Join-Path $workspaceRoot "kubejs\assets\kubejs\textures\gui\day_moon_small.png") `
    -Destination (Join-Path $textureTarget "day_moon_small.png") `
    -Force
Copy-Item `
    -LiteralPath (Join-Path $workspaceRoot "kubejs\assets\kubejs\textures\gui\day_moon_dark.png") `
    -Destination (Join-Path $textureTarget "day_moon_dark.png") `
    -Force

& (Join-Path $javaBin "jar.exe") --create --file $outputJar -C $stageRoot .
if ($LASTEXITCODE -ne 0) {
    throw "jar failed with exit code $LASTEXITCODE"
}

Write-Output "Built $outputJar"
