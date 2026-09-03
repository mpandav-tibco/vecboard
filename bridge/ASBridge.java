/*
 * ASBridge.java — REST bridge for TIBCO ActiveSpaces 5.x
 *
 * Exposes the native AS Java API as a JSON HTTP service so the browser-based
 * vector-admin-ui can talk to ActiveSpaces without a native client.
 *
 * Compile:  javac -cp "C:\tibco\as\5.2\lib\tibdg.jar" ASBridge.java
 * Run:      java  -cp ".;C:\tibco\as\5.2\lib\tibdg.jar" ^
 *                 -Djava.library.path="C:\tibco\as\5.2\bin" ^
 *                 ASBridge [port]
 *
 * The bridge is stateless per-request except for a connection pool keyed on
 * "realmURL|gridName".  Callers must supply:
 *   X-AS-Realm-URL   — FTL realm server URL, e.g. http://localhost:8080
 *   X-AS-Grid-Name   — grid name (optional, defaults to null = auto-detect)
 *
 * REST API:
 *   GET    /health
 *   GET    /tables
 *   GET    /tables/{name}
 *   POST   /tables
 *   DELETE /tables/{name}
 *   GET    /tables/{name}/rows?limit=&offset=
 *   POST   /tables/{name}/rows
 *   DELETE /tables/{name}/rows/{id}
 *   POST   /tables/{name}/search/vector
 *   POST   /tables/{name}/search/keyword
 *   POST   /tables/{name}/batch
 */

import com.sun.net.httpserver.*;
import com.tibco.datagrid.*;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

public class ASBridge {

    // ── connection pool ───────────────────────────────────────────────────────

    private static final ConcurrentHashMap<String, CachedConn> POOL = new ConcurrentHashMap<>();
    private static final long IDLE_TTL_MS = 5 * 60 * 1000L; // evict after 5 min idle

    static class CachedConn {
        final Connection conn;
        final Session session;
        final AtomicLong lastUsed = new AtomicLong(System.currentTimeMillis());

        CachedConn(Connection conn, Session session) {
            this.conn = conn;
            this.session = session;
        }

        void touch() { lastUsed.set(System.currentTimeMillis()); }

        boolean isIdle() { return System.currentTimeMillis() - lastUsed.get() > IDLE_TTL_MS; }
    }

    private static CachedConn getConn(String realmURL, String gridName) throws DataGridException {
        String key = realmURL + "|" + (gridName == null ? "" : gridName);
        CachedConn c = POOL.get(key);
        if (c == null) {
            Properties props = new Properties(System.getProperties());
            props.setProperty(Connection.TIBDG_CONNECTION_PROPERTY_STRING_CLIENT_LABEL, "vector-admin-ui bridge");
            props.setProperty(Connection.TIBDG_CONNECTION_PROPERTY_DOUBLE_TIMEOUT, "20");
            Connection conn = DataGrid.connect(realmURL, gridName, props);
            Session session = conn.createSession(props);
            c = new CachedConn(conn, session);
            POOL.put(key, c);
        }
        c.touch();
        return c;
    }

    // ── minimal JSON utilities ────────────────────────────────────────────────

    /** Parse a JSON value from a string. Returns Map, List, String, Number, Boolean or null. */
    static Object jsonParse(String s) {
        if (s == null) return null;
        return new JsonParser(s.trim()).parse();
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> jsonObj(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : Collections.emptyMap();
    }

    @SuppressWarnings("unchecked")
    static List<Object> jsonArr(Object o) {
        return o instanceof List ? (List<Object>) o : Collections.emptyList();
    }

    static String str(Object o) { return o != null ? o.toString() : ""; }

    static int asInt(Object o, int def) {
        if (o == null) return def;
        if (o instanceof Number) return ((Number) o).intValue();
        try { return Integer.parseInt(o.toString()); } catch (Exception e) { return def; }
    }

    static double asDouble(Object o, double def) {
        if (o == null) return def;
        if (o instanceof Number) return ((Number) o).doubleValue();
        try { return Double.parseDouble(o.toString()); } catch (Exception e) { return def; }
    }

    static float[] toFloatArray(Object o) {
        List<Object> arr = jsonArr(o);
        float[] result = new float[arr.size()];
        for (int i = 0; i < arr.size(); i++) result[i] = (float) asDouble(arr.get(i), 0.0);
        return result;
    }

    static String jsonStringify(Object o) {
        if (o == null) return "null";
        if (o instanceof String) {
            String s = (String) o;
            StringBuilder sb = new StringBuilder("\"");
            for (char c : s.toCharArray()) {
                if (c == '"')  sb.append("\\\"");
                else if (c == '\\') sb.append("\\\\");
                else if (c == '\n') sb.append("\\n");
                else if (c == '\r') sb.append("\\r");
                else if (c == '\t') sb.append("\\t");
                else sb.append(c);
            }
            sb.append('"');
            return sb.toString();
        }
        if (o instanceof Boolean) return o.toString();
        if (o instanceof Number) return o.toString();
        if (o instanceof float[]) {
            float[] arr = (float[]) o;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < arr.length; i++) {
                if (i > 0) sb.append(',');
                sb.append(arr[i]);
            }
            return sb.append(']').toString();
        }
        if (o instanceof double[]) {
            double[] arr = (double[]) o;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < arr.length; i++) {
                if (i > 0) sb.append(',');
                sb.append(arr[i]);
            }
            return sb.append(']').toString();
        }
        if (o instanceof List) {
            List<?> list = (List<?>) o;
            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (Object item : list) { if (!first) sb.append(','); first = false; sb.append(jsonStringify(item)); }
            return sb.append(']').toString();
        }
        if (o instanceof Map) {
            Map<?, ?> map = (Map<?, ?>) o;
            StringBuilder sb = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<?, ?> e : map.entrySet()) {
                if (!first) sb.append(',');
                first = false;
                sb.append(jsonStringify(e.getKey().toString())).append(':').append(jsonStringify(e.getValue()));
            }
            return sb.append('}').toString();
        }
        return jsonStringify(o.toString());
    }

    // ── minimal recursive-descent JSON parser ─────────────────────────────────

    static class JsonParser {
        private final String s;
        private int pos;

        JsonParser(String s) { this.s = s; pos = 0; }

        Object parse() {
            skip();
            if (pos >= s.length()) return null;
            char c = s.charAt(pos);
            if (c == '{') return parseObject();
            if (c == '[') return parseArray();
            if (c == '"') return parseString();
            if (s.startsWith("true",  pos)) { pos += 4; return Boolean.TRUE; }
            if (s.startsWith("false", pos)) { pos += 5; return Boolean.FALSE; }
            if (s.startsWith("null",  pos)) { pos += 4; return null; }
            return parseNumber();
        }

        private Map<String, Object> parseObject() {
            Map<String, Object> map = new LinkedHashMap<>();
            pos++; // '{'
            skip();
            while (pos < s.length() && s.charAt(pos) != '}') {
                String key = parseString();
                skip();
                if (pos < s.length() && s.charAt(pos) == ':') pos++;
                skip();
                Object val = parse();
                map.put(key, val);
                skip();
                if (pos < s.length() && s.charAt(pos) == ',') pos++;
                skip();
            }
            if (pos < s.length()) pos++; // '}'
            return map;
        }

        private List<Object> parseArray() {
            List<Object> list = new ArrayList<>();
            pos++; // '['
            skip();
            while (pos < s.length() && s.charAt(pos) != ']') {
                list.add(parse());
                skip();
                if (pos < s.length() && s.charAt(pos) == ',') pos++;
                skip();
            }
            if (pos < s.length()) pos++; // ']'
            return list;
        }

        private String parseString() {
            pos++; // opening '"'
            StringBuilder sb = new StringBuilder();
            while (pos < s.length() && s.charAt(pos) != '"') {
                char c = s.charAt(pos++);
                if (c == '\\' && pos < s.length()) {
                    char esc = s.charAt(pos++);
                    switch (esc) {
                        case '"':  sb.append('"');  break;
                        case '\\': sb.append('\\'); break;
                        case 'n':  sb.append('\n'); break;
                        case 'r':  sb.append('\r'); break;
                        case 't':  sb.append('\t'); break;
                        default:   sb.append(esc);
                    }
                } else {
                    sb.append(c);
                }
            }
            if (pos < s.length()) pos++; // closing '"'
            return sb.toString();
        }

        private Number parseNumber() {
            int start = pos;
            while (pos < s.length() && "0123456789-.eE+".indexOf(s.charAt(pos)) >= 0) pos++;
            String num = s.substring(start, pos);
            if (num.contains(".") || num.contains("e") || num.contains("E")) {
                return Double.parseDouble(num);
            }
            return Long.parseLong(num);
        }

        private void skip() {
            while (pos < s.length() && Character.isWhitespace(s.charAt(pos))) pos++;
        }
    }

    // ── HTTP helpers ──────────────────────────────────────────────────────────

    static String readBody(HttpExchange ex) throws IOException {
        try (InputStream in = ex.getRequestBody()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    static void sendJson(HttpExchange ex, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json");
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = ex.getResponseBody()) { out.write(bytes); }
    }

    static void sendError(HttpExchange ex, int status, String msg) throws IOException {
        sendJson(ex, status, "{\"error\":" + jsonStringify(msg) + "}");
    }

    static void sendOk(HttpExchange ex) throws IOException {
        sendJson(ex, 200, "{}");
    }

    static String header(HttpExchange ex, String name) {
        List<String> vals = ex.getRequestHeaders().get(name);
        return (vals != null && !vals.isEmpty()) ? vals.get(0) : null;
    }

    static String qparam(URI uri, String key) {
        String q = uri.getQuery();
        if (q == null) return null;
        for (String kv : q.split("&")) {
            int idx = kv.indexOf('=');
            if (idx < 0) continue;
            if (kv.substring(0, idx).equals(key)) return kv.substring(idx + 1);
        }
        return null;
    }

    // ── row → JSON ────────────────────────────────────────────────────────────

    static Map<String, Object> rowToMap(Row row, ResultSetMetadata rsm) throws DataGridException {
        Map<String, Object> map = new LinkedHashMap<>();
        int cols = rsm.getColumnCount();
        for (int i = 1; i <= cols; i++) {
            String colName = rsm.getColumnName(i);
            if (colName == null) continue; // AS returns null for expression columns (e.g. COUNT(*), cosine_similarity)
            if (!row.isColumnSet(colName)) continue;
            ColumnType ct = rsm.getColumnType(i);
            String typeName = ct.name().toUpperCase();
            if (typeName.contains("VECTOR")) {
                map.put(colName, row.getVectorFloat32(colName));
            } else if (typeName.equals("STRING") || typeName.equals("VARCHAR")) {
                map.put(colName, row.getString(colName));
            } else if (typeName.equals("LONG") || typeName.equals("INTEGER")) {
                map.put(colName, row.getLong(colName));
            } else if (typeName.equals("DOUBLE") || typeName.equals("FLOAT")) {
                map.put(colName, row.getDouble(colName));
            } else if (typeName.equals("OPAQUE") || typeName.equals("BLOB")) {
                byte[] b = row.getOpaque(colName);
                map.put(colName, b != null ? new String(b, StandardCharsets.UTF_8) : null);
            } else {
                // Fallback — try string
                try { map.put(colName, row.getString(colName)); } catch (Exception ignored) {}
            }
        }
        return map;
    }

    /** Detect the first vector column in a table's metadata. Returns null if none found. */
    static String findVectorColumn(TableMetadata tm) throws DataGridException {
        for (String col : tm.getColumnNames()) {
            ColumnType ct = tm.getColumnType(col);
            if (ct != null && ct.name().toUpperCase().contains("VECTOR")) return col;
        }
        return null;
    }

    /** Map AS distance convention from vector column naming to UI distance names. */
    static String distanceFromColumn(String colName) {
        // VectorStore naming: embedding_<model>_<dim>
        // Default to cosine (most common for semantic search)
        return "cosine";
    }

    // ── handler implementations ───────────────────────────────────────────────

    static void handleHealth(HttpExchange ex, CachedConn c) throws IOException {
        try (GridMetadata gm = c.conn.getGridMetadata(new Properties())) {
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("ready", true);
            resp.put("version", gm.getVersion());
            resp.put("gridName", gm.getGridName());
            sendJson(ex, 200, jsonStringify(resp));
        } catch (Exception e) {
            sendError(ex, 503, e.getMessage());
        }
    }

    static void handleListTables(HttpExchange ex, CachedConn c) throws IOException {
        try (GridMetadata gm = c.conn.getGridMetadata(new Properties())) {
            String[] names = gm.getTableNames();
            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (String name : names) {
                if (!first) sb.append(',');
                first = false;
                Map<String, Object> item = tableToMap(gm, name, c, false);
                sb.append(jsonStringify(item));
            }
            sb.append(']');
            sendJson(ex, 200, sb.toString());
        } catch (Exception e) {
            sendError(ex, 500, e.getMessage());
        }
    }

    static Map<String, Object> tableToMap(GridMetadata gm, String name, CachedConn c, boolean withCount) throws DataGridException {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("name", name);
        try {
            TableMetadata tm = gm.getTableMetadata(name);
            if (tm != null) {
                String vecCol = findVectorColumn(tm);
                if (vecCol != null) {
                    item.put("vectorDimensions", tm.getColumnDimension(vecCol));
                    item.put("distance", distanceFromColumn(vecCol));
                }
                // Build properties list
                List<Map<String, Object>> props = new ArrayList<>();
                for (String col : tm.getColumnNames()) {
                    Map<String, Object> p = new LinkedHashMap<>();
                    p.put("name", col);
                    ColumnType ct = tm.getColumnType(col);
                    String typeName = ct.name().toUpperCase();
                    if (typeName.contains("VECTOR")) {
                        p.put("dataType", "VECTOR_FLOAT32(" + tm.getColumnDimension(col) + ")");
                    } else {
                        p.put("dataType", ct.name());
                    }
                    props.add(p);
                }
                item.put("properties", props);
            }
        } catch (Exception ignored) {}

        if (withCount) {
            try {
                long count = countRows(c, name);
                item.put("objectCount", count);
            } catch (Exception ignored) {}
        }
        return item;
    }

    static long countRows(CachedConn c, String table) throws DataGridException {
        // Alias required: AS SQL engine returns null column name for COUNT(*) without alias
        String sql = "SELECT COUNT(*) AS cnt FROM " + table;
        try (Statement stmt = c.session.createStatement(sql, new Properties());
             ResultSet rs = stmt.executeQuery(new Properties())) {
            for (Row row : rs) {
                try {
                    long v = row.getLong("cnt");
                    row.destroy();
                    return v;
                } catch (Exception e) {
                    row.destroy();
                    System.err.printf("[bridge] countRows getLong(cnt) failed for %s: %s%n", table, e.getMessage());
                }
            }
        }
        return 0;
    }

    static void handleGetTable(HttpExchange ex, CachedConn c, String name) throws IOException {
        try (GridMetadata gm = c.conn.getGridMetadata(new Properties())) {
            TableMetadata tm = gm.getTableMetadata(name);
            if (tm == null) { sendError(ex, 404, "Table not found: " + name); return; }
            Map<String, Object> item = tableToMap(gm, name, c, true);
            sendJson(ex, 200, jsonStringify(item));
        } catch (Exception e) {
            sendError(ex, 500, e.getMessage());
        }
    }

    static void handleCreateTable(HttpExchange ex, CachedConn c) throws IOException {
        String body = readBody(ex);
        Map<String, Object> req = jsonObj(jsonParse(body));
        String name = str(req.get("name"));
        int dim = asInt(req.get("vectorDimensions"), 768);
        String dist = str(req.getOrDefault("distance", "cosine"));
        if (name.isEmpty()) { sendError(ex, 400, "name is required"); return; }

        // Map distance to AS similarity function naming convention
        String embColName = "embedding_default_" + dim;

        String ddl = "CREATE TABLE IF NOT EXISTS " + name +
                " (id VARCHAR PRIMARY KEY, content VARCHAR, " +
                embColName + " VECTOR_FLOAT32(" + dim + "), metadata VARCHAR)" +
                " row_counts=exact";
        try {
            c.session.executeUpdate(ddl, new Properties());
            sendJson(ex, 201, "{}");
        } catch (DataGridException e) {
            sendError(ex, 500, e.getMessage());
        }
    }

    static void handleDropTable(HttpExchange ex, CachedConn c, String name) throws IOException {
        try {
            c.session.executeUpdate("DROP TABLE IF EXISTS " + name, new Properties());
            sendOk(ex);
        } catch (DataGridException e) {
            sendError(ex, 500, e.getMessage());
        }
    }

    static void handleListRows(HttpExchange ex, CachedConn c, String table) throws IOException {
        int limit  = asInt(qparam(ex.getRequestURI(), "limit"),  20);
        int offset = asInt(qparam(ex.getRequestURI(), "offset"), 0);

        try {
            long total = countRows(c, table);
            // AS hash storage doesn't guarantee LIMIT covers all rows — fetch all rows
            // sorted by id and paginate entirely in Java.
            String sql = "SELECT * FROM " + table + " ORDER BY id";
            List<Map<String, Object>> objects = new ArrayList<>();

            try (Statement stmt = c.session.createStatement(sql, new Properties())) {
                ResultSetMetadata rsm = stmt.getResultSetMetadata();
                try (ResultSet rs = stmt.executeQuery(new Properties())) {
                    int skipped = 0;
                    for (Row row : rs) {
                        if (skipped < offset) { skipped++; row.destroy(); continue; }
                        if (objects.size() >= limit) { row.destroy(); continue; } // past page end
                        Map<String, Object> rowMap = rowToMap(row, rsm);
                        row.destroy();

                        Map<String, Object> obj = new LinkedHashMap<>();
                        Map<String, Object> props = new LinkedHashMap<>();
                        float[] vector = null;

                        for (Map.Entry<String, Object> e : rowMap.entrySet()) {
                            String col = e.getKey();
                            Object val = e.getValue();
                            if (col.equals("id")) {
                                obj.put("id", val);
                            } else if (val instanceof float[]) {
                                vector = (float[]) val;
                            } else if (col.equals("metadata") && val instanceof String) {
                                // Expand metadata JSON back into individual properties
                                // so the UI sees clean key/value pairs, not a raw JSON string
                                try {
                                    Object parsed = jsonParse((String) val);
                                    if (parsed instanceof Map) {
                                        for (Map.Entry<?, ?> me : ((Map<?, ?>) parsed).entrySet()) {
                                            String k = me.getKey().toString();
                                            if (!props.containsKey(k)) props.put(k, me.getValue());
                                        }
                                    }
                                } catch (Exception ignored) {
                                    props.put(col, val);
                                }
                            } else {
                                props.put(col, val);
                            }
                        }
                        obj.put("properties", props);
                        obj.put("class", table);
                        if (vector != null) obj.put("vector", vector);
                        objects.add(obj);
                    }
                }
            }

            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("objects", objects);
            resp.put("total", total);
            sendJson(ex, 200, jsonStringify(resp));
        } catch (DataGridException e) {
            sendError(ex, 500, e.getMessage());
        }
    }

    // Populate a row using the fixed AS schema:
    //   id (PK), content (text), embedding_* (vector), metadata (all props as JSON)
    static void populateRow(Row row, String id, Map<String, Object> props, float[] vector, String vecCol)
            throws DataGridException {
        row.setString("id", id);
        Object contentVal = props.get("content");
        if (contentVal != null) row.setString("content", str(contentVal));
        // Serialize all properties (except id) into metadata
        Map<String, Object> meta = new LinkedHashMap<>(props);
        meta.remove("id");
        if (!meta.isEmpty()) row.setString("metadata", jsonStringify(meta));
        if (vector != null && vecCol != null) row.setVectorFloat32(vecCol, vector);
    }

    static void handleCreateRow(HttpExchange ex, CachedConn c, String table) throws IOException {
        String body = readBody(ex);
        Map<String, Object> req = jsonObj(jsonParse(body));
        Map<String, Object> props = jsonObj(req.get("properties"));
        float[] vector = req.containsKey("vector") ? toFloatArray(req.get("vector")) : null;
        String id = props.containsKey("id") ? str(props.get("id")) : UUID.randomUUID().toString();

        try (GridMetadata gm = c.conn.getGridMetadata(new Properties())) {
            TableMetadata tm = gm.getTableMetadata(table);
            if (tm == null) { sendError(ex, 404, "Table not found: " + table); return; }
            String vecCol = findVectorColumn(tm);

            Table t = c.session.openTable(table, new Properties());
            try {
                Row row = t.createRow();
                try {
                    populateRow(row, id, props, vector, vecCol);
                    t.put(row);
                } finally {
                    row.destroy();
                }
            } finally {
                t.close();
            }

            sendJson(ex, 201, "{\"id\":" + jsonStringify(id) + "}");
        } catch (DataGridException e) {
            sendError(ex, 500, e.getMessage());
        }
    }

    static void handleDeleteRow(HttpExchange ex, CachedConn c, String table, String id) throws IOException {
        try {
            Table t = c.session.openTable(table, new Properties());
            try {
                Row key = t.createRow();
                try {
                    key.setString("id", id);
                    t.delete(key);
                } finally {
                    key.destroy();
                }
            } finally {
                t.close();
            }
            sendOk(ex);
        } catch (DataGridException e) {
            sendError(ex, 500, e.getMessage());
        }
    }

    static void handleVectorSearch(HttpExchange ex, CachedConn c, String table) throws IOException {
        String body = readBody(ex);
        Map<String, Object> req = jsonObj(jsonParse(body));
        float[] vector = toFloatArray(req.get("vector"));
        int limit = asInt(req.get("limit"), 10);

        if (vector.length == 0) { sendError(ex, 400, "vector is required"); return; }

        try (GridMetadata gm = c.conn.getGridMetadata(new Properties())) {
            TableMetadata tm = gm.getTableMetadata(table);
            if (tm == null) { sendError(ex, 404, "Table not found: " + table); return; }
            String vecCol = findVectorColumn(tm);
            if (vecCol == null) { sendError(ex, 400, "No vector column found in table " + table); return; }

            // AS requires ORDER BY columns to be in SELECT. Include cosine_similarity AS score
            // so the sort is correct; rowToMap skips it (null column name) and we score by rank.
            String sql = "SELECT id, content, " + vecCol + ", metadata, cosine_similarity(" + vecCol + ", ?) AS score FROM " + table +
                    " ORDER BY score DESC LIMIT " + limit;

            List<Map<String, Object>> results = new ArrayList<>();
            try (Statement stmt = c.session.createStatement(sql, new Properties())) {
                stmt.setVectorFloat32(1, vector);
                ResultSetMetadata rsm = stmt.getResultSetMetadata();
                try (ResultSet rs = stmt.executeQuery(new Properties())) {
                    int rank = 0;
                    for (Row row : rs) {
                        Map<String, Object> raw = rowToMap(row, rsm);
                        row.destroy();
                        rank++;

                        Map<String, Object> result = new LinkedHashMap<>();
                        result.put("id", raw.getOrDefault("id", ""));
                        result.put("score", Math.max(0.0, 1.0 - (rank - 1) * 0.05));
                        result.put("class", table);

                        Map<String, Object> props = new LinkedHashMap<>();
                        for (Map.Entry<String, Object> e : raw.entrySet()) {
                            if (!e.getKey().equals("id") && !(e.getValue() instanceof float[])) {
                                props.put(e.getKey(), e.getValue());
                            }
                        }
                        result.put("properties", props);
                        results.add(result);
                    }
                }
            }
            sendJson(ex, 200, jsonStringify(results));
        } catch (DataGridException e) {
            sendError(ex, 500, e.getMessage());
        }
    }

    static void handleKeywordSearch(HttpExchange ex, CachedConn c, String table) throws IOException {
        String body = readBody(ex);
        Map<String, Object> req = jsonObj(jsonParse(body));
        String query = str(req.get("query"));
        int limit = asInt(req.get("limit"), 10);
        List<Object> propsHint = jsonArr(req.get("properties"));
        String searchCol = propsHint.isEmpty() ? "content" : str(propsHint.get(0));
        if (query.isEmpty()) { sendError(ex, 400, "query is required"); return; }

        try {
            String sql = "SELECT * FROM " + table +
                    " WHERE " + searchCol + " LIKE \"%" + query.replace("\"", "") + "%\"" +
                    " LIMIT " + limit;

            List<Map<String, Object>> results = new ArrayList<>();
            int rank = 0;
            try (Statement stmt = c.session.createStatement(sql, new Properties())) {
                ResultSetMetadata rsm = stmt.getResultSetMetadata();
                try (ResultSet rs = stmt.executeQuery(new Properties())) {
                    for (Row row : rs) {
                        Map<String, Object> raw = rowToMap(row, rsm);
                        row.destroy();
                        rank++;

                        Map<String, Object> result = new LinkedHashMap<>();
                        result.put("id", raw.getOrDefault("id", ""));
                        result.put("score", 1.0 - (rank - 1) * 0.01);
                        result.put("class", table);

                        Map<String, Object> props = new LinkedHashMap<>();
                        for (Map.Entry<String, Object> e : raw.entrySet()) {
                            if (!e.getKey().equals("id") && !(e.getValue() instanceof float[])) {
                                props.put(e.getKey(), e.getValue());
                            }
                        }
                        result.put("properties", props);
                        results.add(result);
                    }
                }
            }
            sendJson(ex, 200, jsonStringify(results));
        } catch (DataGridException e) {
            sendError(ex, 500, e.getMessage());
        }
    }

    static void handleBatchInsert(HttpExchange ex, CachedConn c, String table) throws IOException {
        String body = readBody(ex);
        Map<String, Object> req = jsonObj(jsonParse(body));
        List<Object> rawObjects = jsonArr(req.get("objects"));

        if (rawObjects.isEmpty()) { sendJson(ex, 200, "{\"success\":0,\"errors\":[]}"); return; }

        List<String> errors = new ArrayList<>();
        int successCount = 0;

        try (GridMetadata gm = c.conn.getGridMetadata(new Properties())) {
            TableMetadata tm = gm.getTableMetadata(table);
            if (tm == null) { sendError(ex, 404, "Table not found: " + table); return; }
            String vecCol = findVectorColumn(tm);

            Table t = c.session.openTable(table, new Properties());
            try {
                for (Object obj : rawObjects) {
                    Map<String, Object> item = jsonObj(obj);
                    Map<String, Object> props = jsonObj(item.get("properties"));
                    float[] vector = item.containsKey("vector") ? toFloatArray(item.get("vector")) : null;
                    String id = item.containsKey("id") && item.get("id") != null
                            ? str(item.get("id")) : UUID.randomUUID().toString();

                    Row row = t.createRow();
                    try {
                        populateRow(row, id, props, vector, vecCol);
                        t.put(row);
                        successCount++;
                    } catch (DataGridException e) {
                        errors.add(id + ": " + e.getMessage());
                    } finally {
                        row.destroy();
                    }
                }
            } finally {
                t.close();
            }
        } catch (DataGridException e) {
            sendError(ex, 500, e.getMessage());
            return;
        }

        System.out.printf("[bridge] batch insert: success=%d errors=%d%n", successCount, errors.size());
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("success", successCount);
        resp.put("errors", errors);
        sendJson(ex, 200, jsonStringify(resp));
    }

    // ── static UI file serving ────────────────────────────────────────────────

    static void serveStatic(HttpExchange ex, String path) {
        try {
            if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
            InputStream is = ASBridge.class.getResourceAsStream("/static" + path);
            // React Router: unknown client-side routes fall back to index.html
            if (is == null) is = ASBridge.class.getResourceAsStream("/static/index.html");
            if (is == null) {
                byte[] msg = ("UI not embedded in this JAR. " +
                        "Build with build.bat / build.sh, or open the Vite dev server.").getBytes(StandardCharsets.UTF_8);
                ex.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
                ex.sendResponseHeaders(404, msg.length);
                ex.getResponseBody().write(msg);
                ex.close();
                return;
            }
            byte[] body = is.readAllBytes();
            is.close();
            ex.getResponseHeaders().set("Content-Type", contentType(path));
            ex.getResponseHeaders().set("Cache-Control", "no-cache");
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        } catch (IOException e) {
            try { ex.sendResponseHeaders(500, -1); ex.close(); } catch (IOException ignored) {}
        }
    }

    static String contentType(String path) {
        if (path.endsWith(".html"))  return "text/html; charset=utf-8";
        if (path.endsWith(".js"))    return "application/javascript";
        if (path.endsWith(".css"))   return "text/css";
        if (path.endsWith(".json"))  return "application/json";
        if (path.endsWith(".svg"))   return "image/svg+xml";
        if (path.endsWith(".png"))   return "image/png";
        if (path.endsWith(".ico"))   return "image/x-icon";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".woff"))  return "font/woff";
        return "application/octet-stream";
    }

    // ── request router ────────────────────────────────────────────────────────

    static void route(HttpExchange ex) {
        String method = ex.getRequestMethod().toUpperCase();
        String path   = ex.getRequestURI().getPath();

        // Handle CORS preflight
        if (method.equals("OPTIONS")) {
            try {
                ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
                ex.getResponseHeaders().set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
                ex.getResponseHeaders().set("Access-Control-Allow-Headers",
                        "Content-Type,X-AS-Realm-URL,X-AS-Grid-Name");
                ex.sendResponseHeaders(204, -1);
            } catch (IOException ignored) {}
            return;
        }

        // Serve embedded React UI for any GET that isn't an AS API path
        if (method.equals("GET") && !path.equals("/health") && !path.startsWith("/tables")) {
            serveStatic(ex, path);
            return;
        }

        // Read connection context from headers
        String realmURL = header(ex, "X-AS-Realm-URL");
        String gridName = header(ex, "X-AS-Grid-Name");
        if (realmURL == null || realmURL.isEmpty()) realmURL = "http://localhost:8080";

        System.out.printf("[bridge] %s %s  realm=%s  grid=%s%n", method, path, realmURL, gridName == null ? "_default" : gridName);

        String poolKey = realmURL + "|" + (gridName == null ? "" : gridName);
        CachedConn c;
        try {
            c = getConn(realmURL, gridName);
        } catch (DataGridException e) {
            try { sendError(ex, 503, "Cannot connect to ActiveSpaces at " + realmURL + ": " + e.getMessage()); }
            catch (IOException ignored) {}
            return;
        }

        // Normalise path: remove trailing slash
        if (path.endsWith("/") && path.length() > 1) path = path.substring(0, path.length() - 1);

        try {
            // GET /health
            if (method.equals("GET") && path.equals("/health")) {
                handleHealth(ex, c); return;
            }
            // GET /tables
            if (method.equals("GET") && path.equals("/tables")) {
                handleListTables(ex, c); return;
            }
            // POST /tables
            if (method.equals("POST") && path.equals("/tables")) {
                handleCreateTable(ex, c); return;
            }

            // Routes under /tables/{name}
            if (path.startsWith("/tables/")) {
                String rest = path.substring("/tables/".length()); // e.g. "mytable" or "mytable/rows" ...
                String[] parts = rest.split("/", -1);
                String tableName;
                try { tableName = URLDecoder.decode(parts[0], "UTF-8"); }
                catch (Exception e) { tableName = parts[0]; }

                if (parts.length == 1) {
                    // GET/DELETE /tables/{name}
                    if (method.equals("GET"))    { handleGetTable(ex, c, tableName); return; }
                    if (method.equals("DELETE")) { handleDropTable(ex, c, tableName); return; }
                }

                if (parts.length >= 2 && parts[1].equals("rows")) {
                    if (parts.length == 2) {
                        // GET/POST /tables/{name}/rows
                        if (method.equals("GET"))  { handleListRows(ex, c, tableName); return; }
                        if (method.equals("POST")) { handleCreateRow(ex, c, tableName); return; }
                    } else if (parts.length == 3 && method.equals("DELETE")) {
                        // DELETE /tables/{name}/rows/{id}
                        String id;
                        try { id = URLDecoder.decode(parts[2], "UTF-8"); }
                        catch (Exception e) { id = parts[2]; }
                        handleDeleteRow(ex, c, tableName, id); return;
                    }
                }

                if (parts.length == 3 && parts[1].equals("search")) {
                    if (method.equals("POST") && parts[2].equals("vector"))  { handleVectorSearch(ex, c, tableName); return; }
                    if (method.equals("POST") && parts[2].equals("keyword")) { handleKeywordSearch(ex, c, tableName); return; }
                }

                if (parts.length == 2 && parts[1].equals("batch") && method.equals("POST")) {
                    handleBatchInsert(ex, c, tableName); return;
                }
            }

            sendError(ex, 404, "Not found: " + method + " " + path);
        } catch (IOException e) {
            System.err.println("[error] I/O error: " + e.getMessage());
        } catch (Exception e) {
            // Unexpected (e.g. stale connection not caught by handler) — evict and report
            System.err.println("[error] Unexpected: " + e);
            POOL.remove(poolKey);
            try { sendError(ex, 503, e.getMessage() != null ? e.getMessage() : e.getClass().getName()); }
            catch (IOException ignored) {}
        }
    }

    // ── launch helpers ────────────────────────────────────────────────────────

    static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    /** Scan standard install locations for the AS 5.2 native lib directory. */
    static String findASBinPath() {
        String asHome = System.getenv("AS_HOME");
        String[] candidates = isWindows()
            ? new String[]{
                "C:\\tibco\\as\\5.2\\bin",
                "C:\\Program Files\\TIBCO\\as\\5.2\\bin",
                asHome != null ? asHome + "\\bin" : null }
            : new String[]{
                "/opt/tibco/as/5.2/bin",
                "/tibco/as/5.2/bin",
                "/usr/local/tibco/as/5.2/bin",
                asHome != null ? asHome + "/bin" : null };
        for (String p : candidates)
            if (p != null && new File(p).isDirectory()) return p;
        return null;
    }

    /** Scan for the FTL native lib directory relative to the AS path. */
    static String findFTLBinPath(String asBin) {
        // asBin is like /opt/tibco/as/5.2/bin — FTL sits beside it
        String sep = isWindows() ? "\\" : "/";
        String tibcoRoot = asBin
            .replace(sep + "as" + sep + "5.2" + sep + "bin", "");
        for (String v : new String[]{"7.2", "7.1", "7.0"}) {
            String candidate = tibcoRoot + sep + "ftl" + sep + v + sep + "bin";
            if (new File(candidate).isDirectory()) return candidate;
        }
        return null;
    }

    /**
     * Relaunch this JAR as a child process with the correct -Djava.library.path
     * (and LD_LIBRARY_PATH on Linux) so the AS native libs load correctly.
     * The child sets -Dasbridge.relaunched=1 to prevent infinite recursion.
     */
    static void relaunchWithASPath(String asBin, String[] args) throws Exception {
        String ftlBin  = findFTLBinPath(asBin);
        String libPath = asBin + (ftlBin != null ? File.pathSeparator + ftlBin : "");

        // Resolve the java executable from the running JVM home
        String javaHome = System.getProperty("java.home", "");
        String javaExe  = javaHome + File.separator + "bin"
                        + File.separator + "java" + (isWindows() ? ".exe" : "");
        if (!new File(javaExe).exists()) javaExe = "java";

        // Resolve this JAR's absolute path
        String jarPath = new File(
            ASBridge.class.getProtectionDomain().getCodeSource().getLocation().toURI()
        ).getAbsolutePath();

        List<String> cmd = new ArrayList<>(Arrays.asList(
            javaExe,
            "-Djava.library.path=" + libPath,
            "-Dasbridge.relaunched=1",
            "-jar", jarPath
        ));
        cmd.addAll(Arrays.asList(args));

        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.inheritIO();

        Map<String, String> env = pb.environment();
        if (isWindows()) {
            // java.library.path lets Java load tibdgjni.dll, but that DLL itself
            // needs FTL DLLs via the normal Windows DLL search (PATH).
            String pathKey = "PATH";
            String existingPath = "";
            for (String k : new ArrayList<>(env.keySet())) {
                if (k.equalsIgnoreCase("PATH")) { pathKey = k; existingPath = env.get(k); break; }
            }
            env.put(pathKey, asBin + (ftlBin != null ? ";" + ftlBin : "") + ";" + existingPath);
        } else {
            // Linux: dynamic linker uses LD_LIBRARY_PATH for transitive .so deps
            String existing = env.getOrDefault("LD_LIBRARY_PATH", "");
            env.put("LD_LIBRARY_PATH",
                libPath.replace(File.pathSeparator, ":") + (existing.isEmpty() ? "" : ":" + existing));
        }
        System.exit(pb.start().waitFor());
    }

    /** Open the browser using an OS-native command (no java.desktop module needed). */
    static void autoOpenBrowser(int port) {
        String url = "http://localhost:" + port;
        Thread t = new Thread(() -> {
            try {
                Thread.sleep(400); // let the server fully bind first
                if (isWindows()) {
                    new ProcessBuilder("rundll32", "url.dll,FileProtocolHandler", url).start();
                } else {
                    String opener = System.getProperty("os.name", "").toLowerCase().contains("mac")
                        ? "open" : "xdg-open";
                    new ProcessBuilder(opener, url).start();
                }
            } catch (Exception e) {
                System.out.println("[bridge] Could not open browser automatically: " + e.getMessage());
                System.out.println("[bridge] Open manually: " + url);
            }
        }, "browser-opener");
        t.setDaemon(true);
        t.start();
    }

    // ── main ──────────────────────────────────────────────────────────────────

    public static void main(String[] args) throws Exception {
        // Self-relaunch: if AS native libs aren't on java.library.path yet,
        // find them on disk and restart this JAR with the right JVM flag.
        // -Dasbridge.relaunched=1 guards against infinite loops.
        if (!"1".equals(System.getProperty("asbridge.relaunched"))) {
            String asBin = findASBinPath();
            if (asBin != null) {
                String cur = System.getProperty("java.library.path", "");
                if (!cur.contains(asBin)) {
                    System.out.println("[bridge] AS found at " + asBin + " — relaunching with native libs...");
                    relaunchWithASPath(asBin, args);
                    return; // parent exits; child process takes over
                }
            } else {
                System.out.println("[bridge] AS 5.2 not found — AS connections will fail; other databases still work.");
            }
        }

        int port = 7070;
        if (args.length > 0) {
            try { port = Integer.parseInt(args[0]); } catch (NumberFormatException ignored) {}
        }

        // Quiet the AS client logger by default
        try { DataGrid.setLogLevel("warn"); } catch (Exception ignored) {}

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 32);
        server.createContext("/", ASBridge::route);
        server.setExecutor(Executors.newFixedThreadPool(16));
        server.start();

        System.out.println("=============================================================");
        System.out.println(" TIBCO Vector Admin  —  http://localhost:" + port);
        System.out.println("=============================================================");
        System.out.println(" Opening browser... (Ctrl+C to stop)");
        System.out.println("=============================================================");

        autoOpenBrowser(port);

        // Background thread to evict stale connections
        Thread evictor = new Thread(() -> {
            while (!Thread.currentThread().isInterrupted()) {
                try { Thread.sleep(60_000); } catch (InterruptedException e) { break; }
                POOL.entrySet().removeIf(entry -> {
                    if (entry.getValue().isIdle()) {
                        try { entry.getValue().session.close(); } catch (Exception ignored) {}
                        try { entry.getValue().conn.close(); } catch (Exception ignored) {}
                        return true;
                    }
                    return false;
                });
            }
        });
        evictor.setDaemon(true);
        evictor.start();

        Thread.currentThread().join();
    }
}
