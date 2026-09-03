#!/usr/bin/env bash
# TIBCO Vector Admin — run to start, browser opens automatically
# Usage: ./run.sh [port]   (default: 7070)
java -jar "$(dirname "$0")/release/tibco-vector-admin.jar" "$@"
