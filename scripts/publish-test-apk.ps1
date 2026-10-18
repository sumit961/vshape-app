<#
.SYNOPSIS
  Builds, validates and publishes a V-Shape Android debug test APK as a new GitHub pre-release.

.DESCRIPTION
  Permanent, reusable release script. Every time a test APK build is requested, this is the
  one path that produces and ships it:
    1. npm validation (syntax check + JS test suite + web build)
    2. Android native unit tests (gradlew testDebugUnitTest)
    3. Capacitor sync (npx cap sync android)
    4. Android debug build (gradlew assembleDebug)
    5. APK existence/size/SHA-256/signing-certificate verification
    6. Signing-certificate comparison against the most recently published test release
    7. Picking the next unused test-build version/tag
    8-11. An authenticated `gh` upload as a brand-new GitHub pre-release, clearly labelled
          TEST BUILD, with changes/known issues/test results/commit SHA/working-tree state in
          the release notes, and the direct download URL printed at the end.

  It never overwrites or deletes an existing release (always a new tag), never commits or
  pushes source changes, and never touches or exposes the signing keystore, any token, or any
  personal data - the release notes only ever contain public SHA-256 digests.

  Stops immediately with a clear, non-zero-exit error on the first failure of validation, the
  native tests, the build, or the upload - nothing partial is left published.

.PARAMETER Repo
  GitHub "owner/repo" to publish to.

.PARAMETER Changes
  Freeform text summarising what changed in this build, included in the release notes.

.PARAMETER KnownIssues
  Freeform text describing known/remaining issues for this build, included in the release
  notes.

.EXAMPLE
  powershell -File scripts\publish-test-apk.ps1 -Changes "Fixed finish-workout display bug" -KnownIssues "Samsung lock-screen buttons not verified on a real device"
#>
[CmdletBinding()]
param(
    [string]$Repo = "sumit961/vshape-app",
    [string]$Changes = "",
    [string]$KnownIssues = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Write-Step($msg) { Write-Host "" ; Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# --- tool discovery (this machine does not have node/java/gh on PATH by default) ---
$nodeDir = "C:\Program Files\nodejs"
if ((Test-Path "$nodeDir\node.exe") -and -not (Get-Command node -ErrorAction SilentlyContinue)) {
    $env:PATH = "$nodeDir;" + $env:PATH
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "node/npm not found. Install Node.js or add it to PATH." }

if (-not $env:JAVA_HOME -or -not (Test-Path "$env:JAVA_HOME\bin\javac.exe")) {
    $jdkCandidates = @(
        "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot",
        "C:\Program Files\Android\Android Studio\jbr"
    )
    $found = $null
    foreach ($c in $jdkCandidates) { if (Test-Path "$c\bin\javac.exe") { $found = $c; break } }
    if (-not $found) { Fail "No JDK found. Set JAVA_HOME to a valid JDK 17+ installation." }
    $env:JAVA_HOME = $found
}
$env:PATH = "$env:JAVA_HOME\bin;" + $env:PATH

$ghPath = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $ghPath -and (Test-Path "C:\Program Files\GitHub CLI\gh.exe")) { $ghPath = "C:\Program Files\GitHub CLI\gh.exe" }
if (-not $ghPath) { Fail "GitHub CLI (gh) was not found. Install it from https://cli.github.com and re-run." }

# --- 0. authenticated gh check - fail fast, before building anything ---
Write-Step "Checking GitHub CLI authentication"
& $ghPath auth status | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fail "GitHub CLI is not authenticated. Run 'gh auth login' (or set GH_TOKEN) and re-run this script. Nothing has been built or uploaded."
}
Write-Host "gh is authenticated."

# --- 1. npm validation ---
Write-Step "Running npm validation (syntax check + JS test suite + web build)"
npm run validate
if ($LASTEXITCODE -ne 0) { Fail "npm run validate failed - fix the failing check/test before publishing a test build." }

# --- 2. Android native unit tests ---
Write-Step "Running Android native unit tests"
Push-Location (Join-Path $RepoRoot "android")
try {
    & .\gradlew.bat testDebugUnitTest --console=plain
    if ($LASTEXITCODE -ne 0) { Fail "Android native unit tests failed - fix them before publishing a test build." }
} finally {
    Pop-Location
}

# --- 3. Capacitor sync ---
Write-Step "Syncing Capacitor (npx cap sync android)"
npx cap sync android
if ($LASTEXITCODE -ne 0) { Fail "npx cap sync android failed." }

# --- 4. Android debug build ---
Write-Step "Building the Android debug APK"
Push-Location (Join-Path $RepoRoot "android")
try {
    & .\gradlew.bat assembleDebug --console=plain
    if ($LASTEXITCODE -ne 0) { Fail "gradlew assembleDebug failed." }
} finally {
    Pop-Location
}

$apkPath = Join-Path $RepoRoot "android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apkPath)) { Fail "Expected APK not found at $apkPath after a successful build." }

# Uploaded under a stable, app-branded asset name rather than the raw Gradle output filename.
$uploadApkPath = Join-Path $env:TEMP "VShape-debug.apk"
Copy-Item -Path $apkPath -Destination $uploadApkPath -Force

# --- 5. verify APK existence / size / SHA-256 / signing certificate ---
Write-Step "Verifying the built APK"
$apkFile = Get-Item $apkPath
if ($apkFile.Length -le 0) { Fail "Built APK is zero bytes - refusing to publish." }
$sha256 = (Get-FileHash -Algorithm SHA256 $apkPath).Hash.ToLower()

$sdkRoot = $env:ANDROID_HOME
if (-not $sdkRoot) { $sdkRoot = $env:ANDROID_SDK_ROOT }
if (-not $sdkRoot) {
    $localPropsPath = Join-Path $RepoRoot "android\local.properties"
    if (Test-Path $localPropsPath) {
        $sdkLine = Get-Content $localPropsPath | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
        if ($sdkLine) { $sdkRoot = ($sdkLine -replace '^sdk\.dir=', '') -replace '\\\\', '\' }
    }
}
if (-not $sdkRoot -or -not (Test-Path $sdkRoot)) { Fail "Could not locate the Android SDK (set ANDROID_HOME, or check android/local.properties)." }

$buildToolsDirs = Get-ChildItem (Join-Path $sdkRoot "build-tools") -Directory -ErrorAction SilentlyContinue
if (-not $buildToolsDirs) { Fail "No Android build-tools found under $sdkRoot\build-tools." }
$buildToolsDir = $buildToolsDirs | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
$apksigner = Join-Path $buildToolsDir.FullName "apksigner.bat"
if (-not (Test-Path $apksigner)) { Fail "apksigner not found at $apksigner." }

$verifyOutput = & $apksigner verify --print-certs -v $apkPath
if ($LASTEXITCODE -ne 0) { Fail "apksigner could not verify the built APK's signature:`n$($verifyOutput -join "`n")" }
$certLine = $verifyOutput | Where-Object { $_ -match "Signer #1 certificate SHA-256 digest" } | Select-Object -First 1
if (-not $certLine) { Fail "Could not find the signing certificate's SHA-256 fingerprint in apksigner output." }
$certSha256 = (($certLine -split ":\s*")[-1]).Trim().ToLower()

Write-Host "APK:          $apkPath"
Write-Host "Size:         $($apkFile.Length) bytes"
Write-Host "SHA-256:      $sha256"
Write-Host "Cert SHA-256: $certSha256"

# --- 6. signing compatibility vs. the most recently published test release ---
Write-Step "Checking signing certificate against the most recently published test release"
$prevCertSha256 = $null
$latestTag = $null
$prevReleases = & $ghPath release list --repo $Repo --limit 100 --json tagName,isPrerelease 2>$null | ConvertFrom-Json
if ($prevReleases) {
    $prevTestReleases = $prevReleases | Where-Object { $_.isPrerelease -and $_.tagName -match '^test-build-v(\d+)$' }
    if ($prevTestReleases) {
        $latestTag = ($prevTestReleases | Sort-Object { [int]($_.tagName -replace 'test-build-v', '') } -Descending | Select-Object -First 1).tagName
        $prevBody = & $ghPath release view $latestTag --repo $Repo --json body 2>$null | ConvertFrom-Json
        if ($prevBody -and $prevBody.body -match 'Signing certificate SHA-256:\s*([0-9a-f]{64})') {
            $prevCertSha256 = $Matches[1]
        }
    }
}
$certMismatchWarning = $null
if ($prevCertSha256) {
    if ($prevCertSha256 -ne $certSha256) {
        $certMismatchWarning = "WARNING: this build's signing certificate ($certSha256) does NOT match the most recently published test release's ($prevCertSha256, from $latestTag). Installing this APK over a device that already has that build installed will require an UNINSTALL FIRST, which wipes all app data on that device."
        Write-Host $certMismatchWarning -ForegroundColor Yellow
    } else {
        Write-Host "Signing certificate matches the most recently published test release ($latestTag) - safe to install over it."
    }
} else {
    Write-Host "No previous test release found to compare against."
}

# --- 7. next unused version ---
Write-Step "Determining the next unused test-build version"
$nextNum = 1
if ($prevReleases) {
    $existingNums = $prevReleases.tagName | Where-Object { $_ -match '^test-build-v(\d+)$' } | ForEach-Object { [int]($_ -replace 'test-build-v', '') }
    if ($existingNums) { $nextNum = ($existingNums | Sort-Object -Descending | Select-Object -First 1) + 1 }
}
$tag = "test-build-v$nextNum"
Write-Host "Next unused tag: $tag"

# --- build metadata: commit SHA + working-tree state ---
$commitSha = (git rev-parse HEAD).Trim()
$dirtyFiles = git status --porcelain
$isDirty = [bool]$dirtyFiles
if ($isDirty) {
    $dirtyList = ($dirtyFiles | ForEach-Object { "- $_" }) -join "`n"
    $provenanceNote = "**WARNING: the working tree has UNCOMMITTED changes.** This APK was built from commit ``$commitSha`` PLUS local, uncommitted source changes - it is NOT reproducible from the tagged commit alone.`n`nUncommitted files:`n$dirtyList"
} else {
    $provenanceNote = "Built from commit ``$commitSha`` with a clean working tree - fully reproducible from this commit."
}

$changesText = $Changes
if ([string]::IsNullOrWhiteSpace($changesText)) { $changesText = "(none provided)" }
$knownIssuesText = $KnownIssues
if ([string]::IsNullOrWhiteSpace($knownIssuesText)) { $knownIssuesText = "(none provided)" }
$certWarningSection = ""
if ($certMismatchWarning) { $certWarningSection = "`n$certMismatchWarning`n" }

# --- 8-11. compose notes, create the release, upload, print the URL ---
Write-Step "Publishing GitHub pre-release $tag"
$notesPath = Join-Path $env:TEMP "vshape-release-notes-$tag.md"
$notes = @"
# TEST BUILD - not for production use

This is an automatically published **debug test build**, signed with the local debug
keystore (not the release signing key). For test-device installation only.

## Changes
$changesText

## Known issues
$knownIssuesText

## Build provenance
- Source commit: $commitSha
- $provenanceNote

## Verification
- npm run validate: passed
- Android native unit tests: passed
- SHA-256 (APK file): $sha256
- Signing certificate SHA-256: $certSha256
$certWarningSection
"@
Set-Content -Path $notesPath -Value $notes -Encoding utf8

& $ghPath release create $tag $uploadApkPath --repo $Repo --title "TEST BUILD $tag" --notes-file $notesPath --prerelease
if ($LASTEXITCODE -ne 0) {
    Remove-Item $notesPath -ErrorAction SilentlyContinue
    Remove-Item $uploadApkPath -ErrorAction SilentlyContinue
    Fail "gh release create failed. Check https://github.com/$Repo/releases before retrying - this script never overwrites or deletes an existing release, so a failed attempt should not have left one behind, but verify manually."
}
Remove-Item $notesPath -ErrorAction SilentlyContinue
Remove-Item $uploadApkPath -ErrorAction SilentlyContinue

$releaseUrl = "https://github.com/$Repo/releases/tag/$tag"
$assetUrl = "https://github.com/$Repo/releases/download/$tag/VShape-debug.apk"

Write-Step "Done"
Write-Host "Release:      $releaseUrl"
Write-Host "APK download: $assetUrl"
Write-Host "SHA-256:      $sha256"
Write-Host "Cert SHA-256: $certSha256"
if ($isDirty) { Write-Host "NOTE: this build included uncommitted source changes - see the release notes." -ForegroundColor Yellow }
