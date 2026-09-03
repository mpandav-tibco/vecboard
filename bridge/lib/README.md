# bridge/lib — AS Client Library

Place `tibdg.jar` from your TIBCO ActiveSpaces 5.2 installation here **before building**.

## Where to find tibdg.jar

| OS      | Default path                              |
|---------|-------------------------------------------|
| Windows | `C:\tibco\as\5.2\lib\tibdg.jar`          |
| Linux   | `/opt/tibco/as/5.2/lib/tibdg.jar`        |

```
# Windows
copy C:\tibco\as\5.2\lib\tibdg.jar bridge\lib\tibdg.jar

# Linux / Mac
cp /opt/tibco/as/5.2/lib/tibdg.jar bridge/lib/tibdg.jar
```

## Why is it not in git?

`tibdg.jar` is a proprietary TIBCO library and must not be committed to source control.
It is listed in `.gitignore`.

The build scripts (`build.bat` / `build.sh`) also look for `tibdg.jar` in the standard
AS installation directory automatically, so **if you have AS 5.2 installed you can skip
this step entirely** — just run the build script.
