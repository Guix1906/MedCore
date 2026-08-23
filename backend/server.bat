@echo off
echo ========================================================
echo   Iniciando Backend PHP MedCore (ClinicMed)
echo ========================================================
echo.

set PHP_EXE="%LOCALAPPDATA%\Microsoft\WinGet\Packages\PHP.PHP.8.2_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe"

if exist %PHP_EXE% (
    %PHP_EXE% -c "%~dp0php.ini" -S localhost:8000 -t "%~dp0public"
) else (
    php -c "%~dp0php.ini" -S localhost:8000 -t "%~dp0public"
)
pause
