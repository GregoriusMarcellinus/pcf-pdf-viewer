param (
    [string[]]$Variants = @("Sigma", "DITPAM", "Grey")
)

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
if (-not $rootDir) {
    $rootDir = "C:\Users\marce\Desktop\PCF"
}

$pcfDir = Join-Path $rootDir "PdfViewer"
$solutionDir = Join-Path $rootDir "PdfViewerSolution"
$manifestInputPath = Join-Path $pcfDir "PdfViewer\ControlManifest.Input.xml"
$solutionXmlPath = Join-Path $solutionDir "src\Other\Solution.xml"
$solutionProjPath = Join-Path $solutionDir "PdfViewerSolution.cdsproj"

$managedOutDir = Join-Path $rootDir "Solutions\Managed"
$unmanagedOutDir = Join-Path $rootDir "Solutions\Unmanaged"

New-Item -ItemType Directory -Force -Path $managedOutDir | Out-Null
New-Item -ItemType Directory -Force -Path $unmanagedOutDir | Out-Null

$msbuildPath = "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\MSBuild\Current\Bin\MSBuild.exe"
if (-not (Test-Path $msbuildPath)) {
    throw "MSBuild not found at: $msbuildPath"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

$definitions = @{
    "Sigma" = @{
        Prefix = "sigma"
        Namespace = "Sigma"
        Publisher = "MicrosoftBusinessSolutionServices"
    }
    "DITPAM" = @{
        Prefix = "ditpam"
        Namespace = "DITPAM"
        Publisher = "DITPAM"
    }
    "Grey" = @{
        Prefix = "grey"
        Namespace = "Grey"
        Publisher = "Grey"
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Building Managed Solutions for: $($Variants -join ', ')" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

foreach ($varKey in $Variants) {
    if (-not $definitions.ContainsKey($varKey)) {
        Write-Warning "Unknown variant key: $varKey. Skipping."
        continue
    }

    $target = $definitions[$varKey]
    Write-Host "`n>>> [Building Variant: $varKey]" -ForegroundColor Yellow
    Write-Host "    Publisher: $($target.Publisher)" -ForegroundColor Gray
    Write-Host "    Prefix:    $($target.Prefix)" -ForegroundColor Gray
    Write-Host "    Namespace: $($target.Namespace)" -ForegroundColor Gray
    Write-Host "    Expected:  $($target.Prefix)_$($target.Namespace).PdfViewer" -ForegroundColor Gray

    # 1. Clean intermediate folders to avoid cross-variant contamination
    $pcfOutDir = Join-Path $pcfDir "out"
    $solObjDir = Join-Path $solutionDir "obj\Release"
    $solBinDir = Join-Path $solutionDir "bin\Release"
    if (Test-Path $pcfOutDir) { Remove-Item -Path $pcfOutDir -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path $solObjDir) { Remove-Item -Path $solObjDir -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path $solBinDir) { Remove-Item -Path $solBinDir -Recurse -Force -ErrorAction SilentlyContinue }

    # 2. Update ControlManifest.Input.xml namespace
    $manifestXml = [xml](Get-Content -Path $manifestInputPath -Raw)
    $controlNode = $manifestXml.manifest.control
    $controlNode.SetAttribute("namespace", $target.Namespace)
    $manifestXml.Save($manifestInputPath)
    Write-Host "    [OK] Updated ControlManifest.Input.xml (namespace=$($target.Namespace))" -ForegroundColor Green

    # 3. Update Solution.xml publisher and prefix
    $solXml = [xml](Get-Content -Path $solutionXmlPath -Raw)
    $pubNode = $solXml.ImportExportXml.SolutionManifest.Publisher
    $pubNode.UniqueName = $target.Publisher
    $pubNode.LocalizedNames.LocalizedName.SetAttribute("description", $target.Publisher)
    $pubNode.Descriptions.Description.SetAttribute("description", $target.Publisher)
    $pubNode.CustomizationPrefix = $target.Prefix
    $solXml.Save($solutionXmlPath)
    Write-Host "    [OK] Updated Solution.xml (Publisher=$($target.Publisher), Prefix=$($target.Prefix))" -ForegroundColor Green

    # 4. Clean and build PCF control
    Write-Host "    [..] Running PCF bundle build (npm run build)..." -ForegroundColor Gray
    Push-Location $pcfDir
    try {
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        cmd.exe /c "npm run build"
        $npmCode = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP
        if ($npmCode -ne 0) {
            throw "PCF build failed for $($varKey) with exit code $npmCode"
        }
    } finally {
        Pop-Location
    }
    Write-Host "    [OK] PCF control built successfully." -ForegroundColor Green

    # 5. Clean intermediate files and package Solution via MSBuild
    Write-Host "    [..] Packaging Solution via MSBuild..." -ForegroundColor Gray
    Push-Location $solutionDir
    try {
        $msBuildArgs = @(
            "/t:build",
            "/p:Configuration=Release",
            "/p:PcfAutoNpmInstall=false",
            "/verbosity:minimal",
            "/nologo",
            "$solutionProjPath"
        )
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & $msbuildPath $msBuildArgs
        $msCode = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP
        if ($msCode -ne 0) {
            throw "MSBuild solution packager failed for $($varKey) with exit code $msCode"
        }
    } finally {
        Pop-Location
    }
    Write-Host "    [OK] Solution packager completed." -ForegroundColor Green

    # 6. Copy generated zip files to output directory
    $builtManagedZip = Join-Path $solutionDir "bin\Release\PdfViewerSolution_managed.zip"
    $builtUnmanagedZip = Join-Path $solutionDir "bin\Release\PdfViewerSolution.zip"

    $destManagedZip = Join-Path $managedOutDir "PdfViewer_$($varKey)_managed.zip"
    $destUnmanagedZip = Join-Path $unmanagedOutDir "PdfViewer_$($varKey)_unmanaged.zip"

    Copy-Item -Path $builtManagedZip -Destination $destManagedZip -Force
    Copy-Item -Path $builtUnmanagedZip -Destination $destUnmanagedZip -Force

    # 7. Deep verify managed zip contents
    $expectedControlFolder = "Controls/$($target.Prefix)_$($target.Namespace).PdfViewer"
    $zipArchive = [System.IO.Compression.ZipFile]::OpenRead($destManagedZip)
    $entries = $zipArchive.Entries | ForEach-Object { $_.FullName }

    $manifestEntry = "$expectedControlFolder/ControlManifest.xml"
    $bundleEntry = "$expectedControlFolder/bundle.js"

    if (-not ($entries -contains $manifestEntry)) {
        $zipArchive.Dispose()
        throw "Verification failed: $destManagedZip does not contain $manifestEntry"
    }
    if (-not ($entries -contains $bundleEntry)) {
        $zipArchive.Dispose()
        throw "Verification failed: $destManagedZip does not contain $bundleEntry"
    }

    # Verify solution.xml inside zip
    $solEntry = $zipArchive.GetEntry("solution.xml")
    if ($null -ne $solEntry) {
        $sr = New-Object System.IO.StreamReader($solEntry.Open())
        $solContent = $sr.ReadToEnd()
        $sr.Close()
        if (-not ($solContent -like "*<UniqueName>$($target.Publisher)</UniqueName>*")) {
            $zipArchive.Dispose()
            throw "Verification failed: solution.xml does not contain expected publisher $($target.Publisher)"
        }
        if (-not ($solContent -like "*<CustomizationPrefix>$($target.Prefix)</CustomizationPrefix>*")) {
            $zipArchive.Dispose()
            throw "Verification failed: solution.xml does not contain expected prefix $($target.Prefix)"
        }
    }

    # Verify bundle.js inside zip registers the namespace
    $bEntry = $zipArchive.GetEntry($bundleEntry)
    if ($null -ne $bEntry) {
        $sr = New-Object System.IO.StreamReader($bEntry.Open())
        $bContent = $sr.ReadToEnd()
        $sr.Close()
        if (-not ($bContent -like "*$($target.Namespace).PdfViewer*")) {
            $zipArchive.Dispose()
            throw "Verification failed: bundle.js does not contain $($target.Namespace).PdfViewer"
        }
    }

    $zipArchive.Dispose()

    $fileSizeKb = [Math]::Round((Get-Item $destManagedZip).Length / 1KB, 1)
    Write-Host "    [VERIFIED] $destManagedZip ($fileSizeKb KB)" -ForegroundColor Cyan
    Write-Host "               Component: $($target.Prefix)_$($target.Namespace).PdfViewer" -ForegroundColor Cyan
    Write-Host "               Publisher: $($target.Publisher)" -ForegroundColor Cyan
}

# Ensure default variant (Grey) is restored in workspace files
$defaultTarget = $definitions["Grey"]
$manifestXml = [xml](Get-Content -Path $manifestInputPath -Raw)
$manifestXml.manifest.control.SetAttribute("namespace", $defaultTarget.Namespace)
$manifestXml.Save($manifestInputPath)

$solXml = [xml](Get-Content -Path $solutionXmlPath -Raw)
$pubNode = $solXml.ImportExportXml.SolutionManifest.Publisher
$pubNode.UniqueName = $defaultTarget.Publisher
$pubNode.LocalizedNames.LocalizedName.SetAttribute("description", $defaultTarget.Publisher)
$pubNode.Descriptions.Description.SetAttribute("description", $defaultTarget.Publisher)
$pubNode.CustomizationPrefix = $defaultTarget.Prefix
$solXml.Save($solutionXmlPath)

Write-Host "`n[DEFAULT RESTORED] ControlManifest.Input.xml and Solution.xml set to Grey (prefix: grey)" -ForegroundColor Gray

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host " All 3 Managed Solutions built and verified successfully!" -ForegroundColor Green
Write-Host " Output Directory: $managedOutDir" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
