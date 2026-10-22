# AniRoll for Discord, Windows: fetches the helper (helper.py with the signed Python from python.org) and sets it up.
#   irm https://aniroll.app/downloads/discord/install.ps1 | iex
#   $env:ANIROLL_AUTO_UPDATE='on'; irm … | iex     the same, and it keeps itself up to date
# Only cmdlets: with Smart App Control on, PowerShell runs in Constrained Language Mode. Replaces an older
# setup (the .exe of 1.0.x, or this one) without asking. discord/build.sh fills in the hashes.
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $base = 'https://aniroll.app/downloads/discord'
    $hostName = 'app.aniroll.discord'
    $dir = Join-Path $env:LOCALAPPDATA 'AniRoll Discord'
    $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    switch ($arch) {
        'AMD64' { $file = 'aniroll-discord-windows.zip'; $sha = '__SHA256_AMD64__' }
        'ARM64' { $file = 'aniroll-discord-windows-arm64.zip'; $sha = '__SHA256_ARM64__' }
        default { Write-Host "Sorry, there is no AniRoll for Discord helper for Windows on $arch yet." -ForegroundColor Red; return }
    }
    $zip = Join-Path $env:TEMP "aniroll-discord-$PID.zip"
    try {
        Invoke-WebRequest -Uri "$base/$file" -OutFile $zip -UseBasicParsing
        if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $sha) {
            throw 'the download is not the one it should be. Try again in a minute.'
        }

        # Updating by itself stays as it was, unless the line turns it on
        $settings = Join-Path $dir 'settings.json'
        $kept = if (Test-Path $settings) { Get-Content $settings -Raw } else { '' }
        if ($env:ANIROLL_AUTO_UPDATE -eq 'on') { $kept = '{"auto_update": true}' }

        # A running helper (started by the browser while AniRoll is open) holds on to its files
        Get-Process -Name aniroll-discord -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Get-Process -Name python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dir\*" } |
            Stop-Process -Force -ErrorAction SilentlyContinue
        for ($i = 0; (Test-Path $dir) -and $i -lt 20; $i++) {
            Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path $dir) { Start-Sleep -Milliseconds 250 }
        }
        if (Test-Path $dir) { throw "$dir is in use. Close your browser and run the line again." }
        Expand-Archive -Path $zip -DestinationPath $dir -Force
        Get-ChildItem $dir -Recurse -File | Unblock-File
        if ($kept) { Set-Content -Path $settings -Value $kept -Encoding Ascii }

        # Chrome & co. know the extension by its key (loaded by hand) or its Chrome Web Store id, Firefox by its id
        $bat = Join-Path $dir 'aniroll-discord.bat'
        $manifests = @{
            chrome  = [ordered]@{ name = $hostName; description = 'AniRoll for Discord'; path = $bat; type = 'stdio'
                allowed_origins = @('chrome-extension://gjeghhdlclombagkmgbghopehhooefal/', 'chrome-extension://hmhmljkgppjpmmoodiboockbboniipcj/') }
            firefox = [ordered]@{ name = $hostName; description = 'AniRoll for Discord'; path = $bat; type = 'stdio'
                allowed_extensions = @('discord@aniroll.app') }
        }
        foreach ($b in 'chrome', 'firefox') {
            # Plain ASCII (letters beyond it as \uXXXX): Windows PowerShell would put a byte order mark before UTF-8
            $json = -join ((ConvertTo-Json $manifests[$b]).ToCharArray() | ForEach-Object {
                if ([int]$_ -gt 127) { '\u{0:x4}' -f [int]$_ } else { $_ } })
            Set-Content -Path (Join-Path $dir "$b.json") -Value $json -Encoding Ascii
        }

        # Each browser reads the manifest's place from its own registry key (per user, no admin rights needed)
        $keys = @{
            chrome  = 'Google\Chrome', 'Chromium', 'BraveSoftware\Brave-Browser', 'BraveSoftware\Brave-Origin', 'Microsoft\Edge', 'Vivaldi'
            firefox = 'Mozilla', 'Zen', 'LibreWolf'
        }
        foreach ($b in 'chrome', 'firefox') {
            foreach ($k in $keys[$b]) {
                New-Item -Path "HKCU:\Software\$k\NativeMessagingHosts\$hostName" -Value (Join-Path $dir "$b.json") -Force | Out-Null
            }
        }

        # Whether Windows lets the helper run at all
        $said = & (Join-Path $dir 'python\python.exe') -I (Join-Path $dir 'helper.py') 2>&1
        if ("$said" -notmatch 'AniRoll for Discord') { throw "the helper does not start: $said" }
        Write-Host 'AniRoll for Discord is set up. Reload AniRoll in your browser; Settings > Discord shows it as ready.' -ForegroundColor Green
        if ($kept -match '"auto_update":\s*true') {
            Write-Host "It updates by itself. To stop that: & `"$dir\aniroll-discord.bat`" auto-update off"
        }
    } catch {
        Write-Host "Something went wrong: $($_.Exception.Message)" -ForegroundColor Red
    } finally {
        # Also a half-done or wrong download
        Remove-Item $zip -Force -ErrorAction SilentlyContinue
    }
}
