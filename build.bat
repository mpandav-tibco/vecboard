@echo off
setlocal EnableDelayedExpansion
title TIBCO Vector Admin — Build

echo =============================================================
echo  TIBCO Vector Admin — Fat JAR Build
echo =============================================================
echo.

:: ── 1. Find tibdg.jar ──────────────────────────────────────────────────────
set TIBDG_JAR=
if exist "bridge\lib\tibdg.jar"          set TIBDG_JAR=bridge\lib\tibdg.jar
if exist "C:\tibco\as\5.2\lib\tibdg.jar" set TIBDG_JAR=C:\tibco\as\5.2\lib\tibdg.jar

if "%TIBDG_JAR%"=="" (
    echo ERROR: tibdg.jar not found.
    echo   Looked in: bridge\lib\tibdg.jar
    echo             C:\tibco\as\5.2\lib\tibdg.jar
    echo.
    echo   Either install TIBCO AS 5.2 at C:\tibco\as\5.2\
    echo   or copy tibdg.jar to bridge\lib\tibdg.jar
    exit /b 1
)
echo [OK] tibdg.jar : %TIBDG_JAR%

:: ── 2. Check Node / Java ───────────────────────────────────────────────────
where node >nul 2>&1 || (echo ERROR: node not found. Install Node.js 18+. & exit /b 1)
where javac >nul 2>&1 || (echo ERROR: javac not found. Install JDK 11+. & exit /b 1)
where jar  >nul 2>&1 || (echo ERROR: jar tool not found. Install JDK 11+. & exit /b 1)
echo [OK] Node  : & node --version
echo [OK] Java  : & java  -version 2>&1 | findstr version

:: ── 3. Build React UI ──────────────────────────────────────────────────────
echo.
echo [1/4] Building React UI...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm run build failed.
    exit /b 1
)
echo [OK] React UI built to dist\

:: ── 4. Prepare bridge build directory ─────────────────────────────────────
echo.
echo [2/4] Preparing build staging area...
if exist bridge\build rmdir /s /q bridge\build
mkdir bridge\build\static
xcopy /s /q /y dist\* bridge\build\static\ >nul
echo [OK] UI assets staged to bridge\build\static\

:: ── 5. Compile ASBridge.java ───────────────────────────────────────────────
echo.
echo [3/4] Compiling ASBridge.java...
javac -cp "%TIBDG_JAR%" -d bridge\build bridge\ASBridge.java
if %ERRORLEVEL% neq 0 (
    echo ERROR: Compilation failed.
    exit /b 1
)
echo [OK] ASBridge compiled

:: ── 6. Unpack tibdg.jar into staging dir (makes it part of the fat JAR) ───
::    Use absolute path — relative paths with ".." confuse jar on Windows
for %%F in ("%TIBDG_JAR%") do set TIBDG_ABS=%%~fF
pushd bridge\build
jar xf "%TIBDG_ABS%"
if %ERRORLEVEL% neq 0 (
    popd
    echo ERROR: Failed to extract tibdg.jar.
    exit /b 1
)
popd
echo [OK] tibdg classes merged

:: ── 7. Package the fat JAR ────────────────────────────────────────────────
echo.
echo [4/4] Packaging fat JAR...
if not exist release mkdir release
jar --create --file release\tibco-vector-admin.jar --main-class ASBridge -C bridge\build .
if %ERRORLEVEL% neq 0 (
    echo ERROR: JAR creation failed.
    exit /b 1
)

:: ── Done ──────────────────────────────────────────────────────────────────
echo.
echo =============================================================
echo  BUILD SUCCESSFUL
echo  Output : release\tibco-vector-admin.jar
echo =============================================================
echo.
echo  Share release\tibco-vector-admin.jar + run.bat with your team.
echo  Team members need TIBCO AS 5.2 installed to use AS features.
echo  Weaviate and other databases work without AS.
echo.
echo  To launch now:  run.bat
echo.
