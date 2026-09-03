# ActiveSpaces REST Bridge — Docker image
#
# Build context: the bridge/ directory.
# Requires the AS 5.2 installation zip to be present in the build context OR
# mount it as a bind volume with AS_HOME pointing to the installation directory.
#
# Quick-start (if AS is already installed on the host):
#   docker run --rm -p 9090:9090 \
#     -v C:\tibco\as\5.2:/opt/tibco/as/5.2:ro \
#     as-bridge

FROM eclipse-temurin:17-jre-jammy

ARG AS_HOME=/opt/tibco/as/5.2
ENV AS_HOME=${AS_HOME}
ENV PORT=9090

WORKDIR /app

# Copy bridge source and pre-compiled class (if available)
COPY ASBridge.java ./

# Mount point for the AS installation (tibdg.jar + native libs)
# Expected: ${AS_HOME}/lib/tibdg.jar and ${AS_HOME}/lib/libtibdg.so
VOLUME ["/opt/tibco/as/5.2"]

# Compile on first run if class file is absent, then start the bridge
CMD ["sh", "-c", \
  "if [ ! -f ASBridge.class ]; then \
     javac -cp ${AS_HOME}/lib/tibdg.jar ASBridge.java; \
   fi && \
   LD_LIBRARY_PATH=${AS_HOME}/lib:$LD_LIBRARY_PATH \
   java -cp .:${AS_HOME}/lib/tibdg.jar \
        -Djava.library.path=${AS_HOME}/lib \
        -Dcom.tibco.tibdg.loglevel=warn \
        ASBridge ${PORT}"]

EXPOSE 9090
