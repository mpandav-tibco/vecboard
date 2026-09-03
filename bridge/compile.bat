@echo off
REM Compile the ActiveSpaces REST bridge (Windows)
REM Requires: Java 11+, TIBCO ActiveSpaces 5.2 installed at C:\tibco\as\5.2

set AS_HOME=C:\tibco\as\5.2
set TIBDG_JAR=%AS_HOME%\lib\tibdg.jar

if not exist "%TIBDG_JAR%" (
    echo ERROR: tibdg.jar not found at %TIBDG_JAR%
    echo Please update AS_HOME in this script.
    exit /b 1
)

echo Compiling ASBridge.java...
javac -cp "%TIBDG_JAR%" ASBridge.java

if %ERRORLEVEL% == 0 (
    echo Compilation successful. Run start.bat to start the bridge.
) else (
    echo Compilation failed.
    exit /b 1
)
