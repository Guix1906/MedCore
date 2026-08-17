# Script PowerShell para Sincronização em Tempo Real com o GitHub
$projectDir = (Get-Item $PSScriptRoot).Parent.FullName
Set-Location $projectDir

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " 🔄 MedCore Auto-Sync em Tempo Real (PowerShell)" -ForegroundColor Green
Write-Host " 📂 Monitorando: $projectDir" -ForegroundColor Yellow
Write-Host " Pressione Ctrl+C para encerrar" -ForegroundColor Gray
Write-Host "====================================================" -ForegroundColor Cyan

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $projectDir
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true

$ignoredPatterns = @('\.git\', 'node_modules\', '\.output\', 'dist\', 'dist-ssr\', '\.tanstack\', '\.vinxi\', '\.wrangler\', '\.env')

function Sync-Git {
    $status = git status --porcelain
    if ($status) {
        $time = Get-Date -Format "HH:mm:ss"
        Write-Host "[$time] Mudanças detectadas. Sincronizando..." -ForegroundColor Yellow
        git add .
        $commitMsg = "auto-sync: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        git commit -m "$commitMsg"
        git push origin main
        Write-Host "[$time] ✅ Sincronizado com GitHub!" -ForegroundColor Green
    }
}

# Sincronização inicial
Sync-Git

$lastRun = [DateTime]::MinValue

while ($true) {
    $result = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::All, 2000)
    if (-not $result.TimedOut) {
        $path = $result.Name
        $isIgnored = $false
        foreach ($pattern in $ignoredPatterns) {
            if ($path -match $pattern) {
                $isIgnored = $true
                break
            }
        }

        if (-not $isIgnored) {
            # Debounce 3 segundos
            Start-Sleep -Seconds 3
            Sync-Git
        }
    }
}
