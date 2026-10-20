# Removes AniRoll for Discord's helper from Windows (what the browsers were told, and the program; also the .exe of 1.0.x).
#   irm https://aniroll.app/downloads/discord/uninstall.ps1 | iex
& {
    $hostName = 'app.aniroll.discord'
    $dir = Join-Path $env:LOCALAPPDATA 'AniRoll Discord'
    foreach ($k in 'Google\Chrome', 'Chromium', 'BraveSoftware\Brave-Browser', 'BraveSoftware\Brave-Origin', 'Microsoft\Edge', 'Vivaldi', 'Mozilla', 'Zen', 'LibreWolf') {
        Remove-Item -Path "HKCU:\Software\$k\NativeMessagingHosts\$hostName" -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path $dir)) { Write-Host 'AniRoll for Discord is not set up on this computer.'; return }
    # The browser keeps the helper running while AniRoll is open: stop it, then give Windows a moment to let go of the files
    Get-Process -Name aniroll-discord -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Process -Name python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dir\*" } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    for ($i = 0; (Test-Path $dir) -and $i -lt 20; $i++) {
        Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path $dir) { Start-Sleep -Milliseconds 250 }
    }
    if (Test-Path $dir) {
        Write-Host "Could not remove $dir (in use). Close your browser and run the line again." -ForegroundColor Red
    } else {
        Write-Host 'AniRoll for Discord is removed from this computer. Remove the extension in your browser too.' -ForegroundColor Green
    }
}
