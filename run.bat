@echo off
:: TIBCO Vector Admin — double-click to start, browser opens automatically
:: Usage: run.bat [port]   (default: 7070)
java -jar "%~dp0release\tibco-vector-admin.jar" %*
