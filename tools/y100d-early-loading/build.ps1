[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectDir = [IO.Path]::GetFullPath($PSScriptRoot)
$MinecraftDir = [IO.Path]::GetFullPath((Join-Path $ProjectDir '..\..'))
$JavaHome = Join-Path $env:APPDATA 'PrismLauncher\java\java-runtime-delta'
$Javac = Join-Path $JavaHome 'bin\javac.exe'
$Jar = Join-Path $JavaHome 'bin\jar.exe'
$BuildDir = [IO.Path]::GetFullPath((Join-Path $ProjectDir 'build'))
$ClassesDir = Join-Path $BuildDir 'classes'
$ResourcesDir = Join-Path $BuildDir 'resources'
$HiddenClassesDir = Join-Path $BuildDir 'hidden-classes'
$DistDir = Join-Path $ProjectDir 'dist'
$OutputJar = Join-Path $DistDir 'y100d-early-loading.jar'
$Atlas = Join-Path $MinecraftDir 'branding\loading\y100d-neoforge-loading-animation-atlas-427x1440.png'

if (!(Test-Path -LiteralPath $Javac) -or !(Test-Path -LiteralPath $Jar)) {
    throw "Java 21 toolchain was not found at $JavaHome"
}
if (!(Test-Path -LiteralPath $Atlas)) {
    throw "Production atlas was not found at $Atlas"
}
if (!$BuildDir.StartsWith($ProjectDir, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to clean a build directory outside this project.'
}

$Cache = Join-Path $env:USERPROFILE '.gradle\caches\modules-2\files-2.1'
function Find-OnlyJar([string]$Root, [string]$Name) {
    $Candidates = @(Get-ChildItem -LiteralPath $Root -Recurse -Filter $Name |
        Where-Object { $_.Name -notmatch 'sources|javadoc' })
    if ($Candidates.Count -ne 1) {
        throw "Expected exactly one $Name under $Root; found $($Candidates.Count)."
    }
    return $Candidates[0].FullName
}

$EarlyDisplay = Find-OnlyJar (Join-Path $Cache 'net.neoforged.fancymodloader\earlydisplay\4.0.42') 'earlydisplay-4.0.42.jar'
$Loader = Find-OnlyJar (Join-Path $Cache 'net.neoforged.fancymodloader\loader\4.0.42') 'loader-4.0.42.jar'
$PrismLibraries = Join-Path $env:APPDATA 'PrismLauncher\libraries\org\lwjgl'
$Lwjgl = Join-Path $PrismLibraries 'lwjgl\3.3.3\lwjgl-3.3.3.jar'
$LwjglGlfw = Join-Path $PrismLibraries 'lwjgl-glfw\3.3.3\lwjgl-glfw-3.3.3.jar'
$LwjglOpenGl = Join-Path $PrismLibraries 'lwjgl-opengl\3.3.3\lwjgl-opengl-3.3.3.jar'
$LwjglStb = Join-Path $PrismLibraries 'lwjgl-stb\3.3.3\lwjgl-stb-3.3.3.jar'

$CompileJars = @($EarlyDisplay, $Loader, $Lwjgl, $LwjglGlfw, $LwjglOpenGl, $LwjglStb)
foreach ($Dependency in $CompileJars) {
    if (!(Test-Path -LiteralPath $Dependency)) {
        throw "Compile dependency was not found: $Dependency"
    }
}

if (Test-Path -LiteralPath $BuildDir) {
    Remove-Item -LiteralPath $BuildDir -Recurse -Force
}
New-Item -ItemType Directory -Path $ClassesDir, $ResourcesDir, $HiddenClassesDir, $DistDir -Force | Out-Null

$Source = Join-Path $ProjectDir 'src\main\java\dev\y100d\loading\Y100DAnimatedWindowProvider.java'
$FramebufferSource = Join-Path $ProjectDir 'src\framebuffer\java\net\neoforged\fml\earlydisplay\Y100DCoverFramebuffer.java'
$ClassPath = $CompileJars -join [IO.Path]::PathSeparator
& $Javac --release 21 -encoding UTF-8 -classpath $ClassPath -d $ClassesDir $Source
if ($LASTEXITCODE -ne 0) {
    throw "javac failed with exit code $LASTEXITCODE"
}
& $Javac --release 21 -encoding UTF-8 -classpath $ClassPath -d $HiddenClassesDir $FramebufferSource
if ($LASTEXITCODE -ne 0) {
    throw "hidden framebuffer javac failed with exit code $LASTEXITCODE"
}

Copy-Item -LiteralPath (Join-Path $ProjectDir 'src\main\resources\META-INF') -Destination $ResourcesDir -Recurse -Force
Copy-Item -LiteralPath $Atlas -Destination (Join-Path $ResourcesDir 'y100d_loading_atlas.png') -Force
$HiddenClass = Join-Path $HiddenClassesDir 'net\neoforged\fml\earlydisplay\Y100DCoverFramebuffer.class'
$HiddenResourceDir = Join-Path $ResourcesDir 'META-INF\y100d'
if (!(Test-Path -LiteralPath $HiddenClass)) {
    throw "Hidden framebuffer bytecode was not produced: $HiddenClass"
}
New-Item -ItemType Directory -Path $HiddenResourceDir -Force | Out-Null
Copy-Item -LiteralPath $HiddenClass -Destination (Join-Path $HiddenResourceDir 'Y100DCoverFramebuffer.bin') -Force

if (Test-Path -LiteralPath $OutputJar) {
    Remove-Item -LiteralPath $OutputJar -Force
}
$JarArguments = @(
    '--create'
    '--date=2026-01-01T00:00:00Z'
    '--file', $OutputJar
    '--manifest', (Join-Path $ProjectDir 'src\main\resources\META-INF\MANIFEST.MF')
    '-C', $ClassesDir, '.'
    '-C', $ResourcesDir, '.'
)
& $Jar @JarArguments
if ($LASTEXITCODE -ne 0) {
    throw "jar failed with exit code $LASTEXITCODE"
}

$Hash = (Get-FileHash -LiteralPath $OutputJar -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(
    (Join-Path $DistDir 'y100d-early-loading.jar.sha256'),
    "$Hash  y100d-early-loading.jar`n",
    [Text.UTF8Encoding]::new($false))

Write-Output "Built $OutputJar"
Write-Output "SHA256 $Hash"
