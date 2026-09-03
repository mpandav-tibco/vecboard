#!/usr/bin/env bash
# Build script for TIBCO Vector Admin — produces a self-contained fat JAR
# Usage: ./build.sh
set -euo pipefail

echo "============================================================="
echo " TIBCO Vector Admin — Fat JAR Build"
echo "============================================================="
echo

# ── 1. Find tibdg.jar ────────────────────────────────────────────────────────
TIBDG_JAR=""
[[ -f "bridge/lib/tibdg.jar" ]]              && TIBDG_JAR="bridge/lib/tibdg.jar"
[[ -f "/opt/tibco/as/5.2/lib/tibdg.jar" ]]  && TIBDG_JAR="/opt/tibco/as/5.2/lib/tibdg.jar"
[[ -f "/tibco/as/5.2/lib/tibdg.jar" ]]      && TIBDG_JAR="/tibco/as/5.2/lib/tibdg.jar"

if [[ -z "$TIBDG_JAR" ]]; then
    echo "ERROR: tibdg.jar not found."
    echo "  Looked in: bridge/lib/tibdg.jar"
    echo "             /opt/tibco/as/5.2/lib/tibdg.jar"
    echo ""
    echo "  Either install TIBCO AS 5.2 or copy tibdg.jar to bridge/lib/tibdg.jar"
    exit 1
fi
echo "[OK] tibdg.jar : $TIBDG_JAR"

# ── 2. Check dependencies ────────────────────────────────────────────────────
command -v node  >/dev/null || { echo "ERROR: node not found. Install Node.js 18+."; exit 1; }
command -v javac >/dev/null || { echo "ERROR: javac not found. Install JDK 11+."; exit 1; }
command -v jar   >/dev/null || { echo "ERROR: jar not found. Install JDK 11+."; exit 1; }
echo "[OK] Node  : $(node --version)"
echo "[OK] Java  : $(java -version 2>&1 | head -1)"

# ── 3. Build React UI ────────────────────────────────────────────────────────
echo
echo "[1/4] Building React UI..."
npm run build
echo "[OK] React UI built to dist/"

# ── 4. Prepare staging area ──────────────────────────────────────────────────
echo
echo "[2/4] Preparing build staging area..."
rm -rf bridge/build
mkdir -p bridge/build/static
cp -r dist/* bridge/build/static/
echo "[OK] UI assets staged to bridge/build/static/"

# ── 5. Compile ASBridge.java ─────────────────────────────────────────────────
echo
echo "[3/4] Compiling ASBridge.java..."
javac -cp "$TIBDG_JAR" -d bridge/build bridge/ASBridge.java
echo "[OK] ASBridge compiled"

# ── 6. Merge tibdg classes into staging dir ──────────────────────────────────
pushd bridge/build > /dev/null
jar xf "../../$TIBDG_JAR"
popd > /dev/null
echo "[OK] tibdg classes merged"

# ── 7. Package fat JAR ───────────────────────────────────────────────────────
echo
echo "[4/4] Packaging fat JAR..."
mkdir -p release
jar --create --file release/tibco-vector-admin.jar --main-class ASBridge -C bridge/build .

# ── Done ─────────────────────────────────────────────────────────────────────
echo
echo "============================================================="
echo " BUILD SUCCESSFUL"
echo " Output : release/tibco-vector-admin.jar"
echo "============================================================="
echo
echo " Share release/tibco-vector-admin.jar + run.sh with your team."
echo " Team members need TIBCO AS 5.2 installed to use AS features."
echo " Weaviate and other databases work without AS."
echo
echo " To launch now:  ./run.sh"
echo
