param([Parameter(Mandatory=$true)][string]$Output, [ValidateSet('x64','x86','arm64')][string]$Architecture='x64')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Pin the SDK used to validate the native caption / Acrylic implementation.
$version = '1.5.240311000'
$cache = Join-Path $env:LOCALAPPDATA "zju-build\windowsappsdk-$version"
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (!(Test-Path "$cache\sdk\Microsoft.WindowsAppSDK.nuspec")) {
    New-Item -ItemType Directory -Force $cache | Out-Null
    $url = "https://api.nuget.org/v3-flatcontainer/microsoft.windowsappsdk/$version/microsoft.windowsappsdk.$version.nupkg"
    Invoke-WebRequest -UseBasicParsing $url -OutFile "$cache\sdk.zip"
    [System.IO.Compression.ZipFile]::ExtractToDirectory("$cache\sdk.zip", "$cache\sdk")
}
$sdk = "$cache\sdk"
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vs) { throw 'Visual Studio C++ build tools are required for the Windows backdrop.' }
$vcarch = @{ x64='x64'; x86='x64_x86'; arm64='x64_arm64' }[$Architecture]
$environment = & cmd /d /c "call `"$vs\VC\Auxiliary\Build\vcvarsall.bat`" $vcarch >nul && set"
if ($LASTEXITCODE) { throw 'vcvarsall failed' }
foreach ($line in $environment) {
    if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
}
$cppwinrt = Join-Path $env:WindowsSdkDir "bin\$($env:WindowsSDKVersion.TrimEnd('\'))\x64\cppwinrt.exe"
$generated = "$cache\generated"
if (!(Test-Path "$generated\.complete")) {
    & $cppwinrt -input "$sdk\lib\uap10.0" "$sdk\lib\uap10.0.17763" -reference sdk -output $generated
    if ($LASTEXITCODE) { throw 'C++/WinRT header generation failed' }
    Set-Content "$generated\.complete" $version
}
New-Item -ItemType Directory -Force $Output | Out-Null
$payload = "$cache\runtime-$Architecture"
if (!(Test-Path "$payload\AppxManifest.xml")) {
    [System.IO.Compression.ZipFile]::ExtractToDirectory("$sdk\tools\MSIX\win10-$Architecture\Microsoft.WindowsAppRuntime.1.5.msix", $payload)
}
# Match the SDK's SelfContained payload list; keep resources and localized DLL dependencies.
Get-ChildItem $payload -File -Recurse | Where-Object { $_.Extension -in '.dll','.mui','.png','.winmd','.xaml','.xbf','.pri' -or $_.Name -in 'restartAgent.exe','map.html' } | ForEach-Object {
    $relative = $_.FullName.Substring($payload.Length + 1)
    if ($relative -eq 'resources.pri') { $relative = 'Microsoft.UI.Xaml.Controls.pri' }
    $destination = Join-Path $Output $relative
    New-Item -ItemType Directory -Force (Split-Path $destination) | Out-Null
    if (!(Test-Path $destination) -or (Get-FileHash $_.FullName).Hash -ne (Get-FileHash $destination).Hash) { Copy-Item $_.FullName $destination -Force }
}
Copy-Item "$sdk\license.txt" "$Output\WindowsAppSDK-LICENSE.txt" -Force
# App-local WinRT registration, derived from the SDK's framework manifest.
[xml]$appx = Get-Content "$payload\AppxManifest.xml"
$ns = New-Object System.Xml.XmlNamespaceManager($appx.NameTable)
$ns.AddNamespace('m','http://schemas.microsoft.com/appx/manifest/foundation/windows10')
$manifest = New-Object System.Text.StringBuilder
[void]$manifest.AppendLine('<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1" xmlns:asmv3="urn:schemas-microsoft-com:asm.v3" xmlns:winrt="urn:schemas-microsoft-com:winrt.v1">')
foreach ($server in $appx.SelectNodes('/m:Package/m:Extensions/m:Extension/m:InProcessServer', $ns)) {
    $dll = $server.SelectSingleNode('m:Path', $ns).InnerText
    [void]$manifest.AppendLine("<asmv3:file name=`"$dll`" loadFrom=`"%MICROSOFT_WINDOWSAPPRUNTIME_BASE_DIRECTORY%$dll`">")
    foreach ($class in $server.SelectNodes('m:ActivatableClass', $ns)) {
        [void]$manifest.AppendLine("<winrt:activatableClass name=`"$($class.ActivatableClassId)`" threadingModel=`"both`"/>")
    }
    [void]$manifest.AppendLine('</asmv3:file>')
}
[void]$manifest.AppendLine('</assembly>')
[System.IO.File]::WriteAllText("$Output\runtime.manifest", $manifest.ToString())
# The bridge uses a static CRT. Runtime VC dependencies are deployed app-local as well.
$redist = Get-ChildItem (Join-Path $env:VCToolsRedistDir $Architecture) -Directory -Filter 'Microsoft.VC*.CRT' | Select-Object -First 1 -ExpandProperty FullName
if (!$redist) { throw 'Visual C++ redistributable payload not found' }
Get-ChildItem $redist -Filter '*.dll' | ForEach-Object { Copy-Item $_.FullName $Output -Force }
Push-Location $Output
try {
    & cl.exe /nologo /LD /EHsc /std:c++17 /MT /I $generated /I "$sdk\include" "$PSScriptRoot\acrylic.cpp" /link windowsapp.lib CoreMessaging.lib dwmapi.lib user32.lib /OUT:zju_acrylic.dll
    if ($LASTEXITCODE) { throw 'Windows backdrop bridge compilation failed' }
} finally { Pop-Location }
# Only runtime files belong in the installer.
Remove-Item "$Output\acrylic.obj","$Output\acrylic.lib","$Output\acrylic.exp","$Output\zju_acrylic.lib","$Output\zju_acrylic.exp" -ErrorAction SilentlyContinue
