#!/usr/bin/env bash
# Start the ActiveSpaces REST bridge (Linux/macOS)
# Usage: ./start.sh [port]   Default port: 9090

AS_HOME="${AS_HOME:-/opt/tibco/as/5.2}"
TIBDG_JAR="$AS_HOME/lib/tibdg.jar"
AS_LIB="$AS_HOME/lib"
PORT="${1:-9090}"

if [[ ! -f "$TIBDG_JAR" ]]; then
    echo "ERROR: tibdg.jar not found at $TIBDG_JAR"
    echo "Set AS_HOME environment variable or update the path in this script."
    exit 1
fi

if [[ ! -f "ASBridge.class" ]]; then
    echo "ASBridge.class not found. Compiling..."
    bash compile.sh || exit 1
fi

echo "Starting ActiveSpaces REST Bridge on port $PORT..."
LD_LIBRARY_PATH="$AS_LIB:$LD_LIBRARY_PATH" \
java -cp ".:$TIBDG_JAR" \
     -Djava.library.path="$AS_LIB" \
     -Dcom.tibco.tibdg.loglevel=warn \
     ASBridge "$PORT"
