@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ======================================================================
echo   MO TRINH DUYET FACEBOOK LIVE TU DONG CHAY NGAM (KHONG CAN BAM F12)
echo ======================================================================
echo.
echo Trinh duyet se tu dong nap Tien ich ngam bat binh luan Facebook Live
echo (Ke ca khi ban thu nho cua so hoac chuyen sang tab khac!).
echo.

set "EXT_DIR=%~dp0tools\fb-live-extension"
set "PROFILE_DIR=%LOCALAPPDATA%\TikTokLive3DRace_FBProfile"

rem Tim Google Chrome hoac Microsoft Edge tren may
set "BROWSER_EXE="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
)

if "%BROWSER_EXE%"=="" (
    echo [LOI] Khong tim thay Chrome hoac Edge. Vui long cai Tien ich thu cong trong chrome://extensions
    pause
    exit /b 1
)

set "TARGET_URL=%~1"
if "%TARGET_URL%"=="" set "TARGET_URL=https://www.facebook.com/watch/live/"

echo Dang mo trinh duyet kem Tien ich chay ngam...
start "" "%BROWSER_EXE%" --user-data-dir="%PROFILE_DIR%" --load-extension="%EXT_DIR%" "http://localhost:3002" "%TARGET_URL%"

echo.
echo [THANH CONG] Da mo trinh duyet kem Tien ich chay ngam!
echo -> Ban chi can mo bai Facebook Live tren cua so vua bat,
echo    binh luan se TU DONG bay ve Duong Dua 3D ma KHONG CAN bam F12!
echo.
timeout /t 5

