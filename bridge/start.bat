@echo off
REM Start the ActiveSpaces REST bridge (Windows)
REM Usage: start.bat [port]
REM Default port: 9090

set AS_HOME=C:\tibco\as\5.2
set TIBDG_JAR=%AS_HOME%\lib\tibdg.jar
set AS_BIN=%AS_HOME%\bin
set PORT=%1
if "%PORT%"=="" set PORT=9090

if not exist "%TIBDG_JAR%" (
    echo ERROR: tibdg.jar not found at %TIBDG_JAR%
    echo Please update AS_HOME in this script.
    exit /b 1
)

if not exist "ASBridge.class" (
    echo ASBridge.class not found. Compiling...
    call compile.bat
    if %ERRORLEVEL% neq 0 exit /b 1
)

echo Starting ActiveSpaces REST Bridge on port %PORT%...
echo FTL Realm URL will be read from X-AS-Realm-URL header in each request.
echo.

java -cp ".;%TIBDG_JAR%" ^
     -Djava.library.path="%AS_BIN%" ^
     -Dcom.tibco.tibdg.loglevel=warn ^
     ASBridge %PORT%
