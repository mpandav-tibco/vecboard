#!/usr/bin/env bash
# Compile the ActiveSpaces REST bridge (Linux/macOS)
# Requires: Java 11+, TIBCO ActiveSpaces 5.2

AS_HOME="${AS_HOME:-/opt/tibco/as/5.2}"
TIBDG_JAR="$AS_HOME/lib/tibdg.jar"

if [[ ! -f "$TIBDG_JAR" ]]; then
    echo "ERROR: tibdg.jar not found at $TIBDG_JAR"
    echo "Set AS_HOME environment variable or update the path in this script."
    exit 1
fi

echo "Compiling ASBridge.java..."
javac -cp "$TIBDG_JAR" ASBridge.java && echo "Compilation successful. Run ./start.sh to start the bridge."
