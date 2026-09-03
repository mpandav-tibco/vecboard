import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Layers, Loader2, AlertCircle, CheckCircle, Lock, Globe, Server,
  Trash2, ChevronDown, ChevronUp, Plus,
} from 'lucide-react'
import { buildBaseURL } from '@/lib/weaviate/client'
import { useConnectionStore } from '@/store/connectionStore'
import { useAppStore } from '@/store/appStore'
import { getAdapter } from '@/lib/adapters'
import type { ConnectionConfig, VectorDBType } from '@/types/domain'
import { cn } from '@/lib/utils/cn'

const DB_LABELS: Record<string, string> = {
  weaviate: 'Weaviate', qdrant: 'Qdrant', chroma: 'Chroma',
  pinecone: 'Pinecone', pgvector: 'pgvector', activespaces: 'ActiveSpaces',
}

const DB_COLORS: Record<string, string> = {
  weaviate:     'bg-green-900/40 text-green-400',
  qdrant:       'bg-red-900/40 text-red-400',
  chroma:       'bg-orange-900/40 text-orange-400',
  pinecone:     'bg-blue-900/40 text-blue-400',
  pgvector:     'bg-sky-900/40 text-sky-400',
  activespaces: 'bg-purple-900/40 text-purple-400',
}

interface DBOption {
  type: VectorDBType
  label: string
  description: string
  defaultPort: number
  available: boolean
}

const DB_OPTIONS: DBOption[] = [
  { type: 'weaviate', label: 'Weaviate', description: 'Open-source vector database', defaultPort: 8080, available: true },
  { type: 'qdrant',   label: 'Qdrant',   description: 'High-performance vector search', defaultPort: 6333, available: true },
  { type: 'chroma',   label: 'Chroma',   description: 'AI-native embedding store', defaultPort: 8000, available: true },
  { type: 'pinecone', label: 'Pinecone', description: 'Managed vector database', defaultPort: 443, available: true },
  { type: 'pgvector', label: 'pgvector', description: 'PostgreSQL + PostgREST', defaultPort: 3000, available: true },
  { type: 'activespaces', label: 'ActiveSpaces', description: 'TIBCO in-memory data grid (5.x)', defaultPort: 8080, available: true },
]

const DEFAULT_PROXY: Partial<Record<VectorDBType, string>> = {
  weaviate:     '/api/weaviate',
  qdrant:       '/api/qdrant',
  chroma:       '/api/chroma',
  pgvector:     '/api/pgvector',
  activespaces: '/api/activespaces',
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms)
    ),
  ])
}

interface EnrichedError { message: string; hint?: string }

function enrichError(raw: string, dbType: VectorDBType, dbLabel: string): EnrichedError {
  const r = raw.toLowerCase()

  if (r.includes('timed out'))
    return {
      message: `${dbLabel} didn't respond within 8 s.`,
      hint: dbType === 'pinecone'
        ? 'Check the index host URL in your Pinecone console.'
        : dbType === 'activespaces'
        ? 'Start the AS REST bridge: cd bridge && start.bat  —  then verify the FTL realm server is running.'
        : `Start it locally: docker compose${dbType !== 'weaviate' ? ` --profile ${dbType}` : ''} up -d`,
    }

  if (r.includes('non-json') || r.includes('unexpected token') || r.includes('<!doctype') || r.includes('html'))
    return {
      message: 'The server returned an HTML page instead of a JSON API response.',
      hint: 'Check the host, port, and proxy settings — the address may be pointing at the wrong server.',
    }

  if (r.includes('401') || r.includes('unauthorized'))
    return { message: 'Authentication failed (HTTP 401).', hint: 'Check your API key.' }

  if (r.includes('403') || r.includes('forbidden'))
    return { message: 'Access denied (HTTP 403).', hint: 'Your API key may not have the required permissions.' }

  if (r.includes('404'))
    return {
      message: 'Endpoint not found (HTTP 404).',
      hint: `Make sure the host and port are correct and ${dbLabel} is actually running there.`,
    }

  if (r.includes('502') || r.includes('bad gateway'))
    return {
      message: 'Proxy got no response from the database (502 Bad Gateway).',
      hint: dbType !== 'pinecone'
        ? `Start the container: docker compose${dbType !== 'weaviate' ? ` --profile ${dbType}` : ''} up -d`
        : 'Check that the Pinecone index is active.',
    }

  if (r.includes('failed to fetch') || r.includes('networkerror') || r.includes('load failed') || r.includes('econnrefused'))
    return {
      message: 'Cannot reach the database — network error.',
      hint: 'Check that the host and port are correct and the service is running.',
    }

  if (r.includes('not yet supported'))
    return { message: raw }

  return { message: raw }
}

export function ConnectPage() {
  const navigate = useNavigate()
  const { setConfig, setStatus, savedConnections, saveConnection, deleteConnection } = useConnectionStore()
  const { setEmbeddingConfig } = useAppStore()

  const [loading, setLoading] = useState(false)
  const [connectingIdx, setConnectingIdx] = useState<number | null>(null)
  const [error, setError] = useState<EnrichedError | null>(null)
  const [showNewForm, setShowNewForm] = useState(savedConnections.length === 0)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [form, setForm] = useState<ConnectionConfig>({
    dbType: 'weaviate', host: 'localhost', port: 8080,
    scheme: 'http', apiKey: '', proxyURL: '/api/weaviate',
  })

  const selectedDB = DB_OPTIONS.find((d) => d.type === form.dbType) ?? DB_OPTIONS[0]
  const isPinecone = form.dbType === 'pinecone'
  const isPgvector = form.dbType === 'pgvector'
  const isActiveSpaces = form.dbType === 'activespaces'

  const handleDBSelect = (opt: DBOption) => {
    if (!opt.available) return
    setForm((f) => ({
      ...f,
      dbType: opt.type,
      port: opt.defaultPort,
      proxyURL: DEFAULT_PROXY[opt.type] ?? '',
      scheme: opt.type === 'pinecone' ? 'https' : f.scheme,
      host: opt.type === 'pinecone' ? '' : f.host,
    }))
    setError(null)   // reset error when DB type changes
  }

  const connectWith = async (cfg: ConnectionConfig, savedIdx?: number) => {
    setLoading(true)
    setConnectingIdx(savedIdx ?? null)
    setError(null)
    setConfig(cfg)
    try {
      const health = await withTimeout(getAdapter(cfg).checkHealth(), 8000)
      if (health.ready) {
        setStatus('connected', undefined, health.version)
        saveConnection(cfg)
        // Sync embedding config if connecting from a saved connection that has one
        if (savedIdx !== undefined) {
          const sc = savedConnections[savedIdx]
          if (sc?.embeddingConfig) setEmbeddingConfig(sc.embeddingConfig)
        }
        navigate('/')
      } else {
        const raw = health.error ?? `Could not connect to ${DB_LABELS[cfg.dbType] ?? cfg.dbType}`
        setStatus('error', raw)
        setError(enrichError(raw, cfg.dbType, DB_LABELS[cfg.dbType] ?? cfg.dbType))
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Connection failed'
      setStatus('error', raw)
      setError(enrichError(raw, cfg.dbType, DB_LABELS[cfg.dbType] ?? cfg.dbType))
    } finally {
      setLoading(false)
      setConnectingIdx(null)
    }
  }

  const handleConnect = (e: React.FormEvent) => { e.preventDefault(); connectWith(form) }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-accent-muted mb-4">
            <Layers className="w-7 h-7 text-accent" />
          </div>
          <h1 className="text-2xl font-bold text-gray-100">Vector Admin UI</h1>
          <p className="mt-1 text-gray-400 text-sm">Connect to your vector database</p>
        </div>

        {/* ── Saved connections (shown first when they exist) ── */}
        {savedConnections.length > 0 && (
          <div className="card p-4 mb-4 space-y-3">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Recent connections</p>
            <div className="space-y-2">
              {savedConnections.map((sc, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 px-3 py-2.5 bg-surface-200 rounded-lg border border-border hover:border-gray-600 transition-colors"
                >
                  <span className={cn('text-[10px] font-semibold rounded px-1.5 py-0.5 flex-shrink-0', DB_COLORS[sc.dbType] ?? 'bg-surface-300 text-gray-400')}>
                    {DB_LABELS[sc.dbType] ?? sc.dbType}
                  </span>
                  <span className="text-sm text-gray-200 truncate flex-1 font-mono" title={sc.label}>
                    {sc.host}:{sc.port}
                  </span>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => connectWith(sc, idx)}
                    className="btn-primary text-xs px-3 py-1 flex-shrink-0"
                  >
                    {connectingIdx === idx ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Connect'}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteConnection(idx)}
                    className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0"
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Divider to new form */}
            <button
              type="button"
              onClick={() => setShowNewForm((v) => !v)}
              className="flex items-center gap-2 w-full text-xs text-gray-500 hover:text-gray-300 transition-colors pt-1"
            >
              <span className="flex-1 h-px bg-border" />
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <Plus className="w-3 h-3" />
                {showNewForm ? 'Hide new connection' : 'New connection'}
              </span>
              <span className="flex-1 h-px bg-border" />
            </button>
          </div>
        )}

        {/* ── New connection form ── */}
        {showNewForm && (
          <div className="card p-6 space-y-5">
            {savedConnections.length > 0 && (
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">New connection</p>
            )}

            {/* DB selector */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">Database</label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {DB_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => handleDBSelect(opt)}
                    disabled={!opt.available}
                    title={opt.available ? opt.description : `${opt.label} — coming soon`}
                    className={cn(
                      'relative flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition-colors',
                      form.dbType === opt.type
                        ? 'border-accent bg-accent-muted text-accent'
                        : opt.available
                        ? 'border-border bg-surface-200 text-gray-300 hover:border-gray-500 hover:text-gray-100'
                        : 'border-border bg-surface-200 text-gray-600 cursor-not-allowed opacity-50'
                    )}
                  >
                    {!opt.available && <Lock className="absolute top-1.5 right-1.5 w-2.5 h-2.5 text-gray-600" />}
                    <span className="text-center leading-tight">{opt.label}</span>
                    {form.dbType === opt.type && <CheckCircle className="w-3 h-3" />}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleConnect} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    {isPinecone ? 'Index Host' : isActiveSpaces ? 'FTL Realm Host' : 'Host'}
                  </label>
                  <input
                    className="input"
                    value={form.host}
                    onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                    placeholder={isPinecone ? 'my-index-abc123.svc.aped-1234.pinecone.io' : 'localhost'}
                    required
                  />
                  {isPinecone && (
                    <p className="mt-1 text-xs text-gray-600">
                      Find the index host in your <span className="text-gray-400">Pinecone console → Indexes → your index → Host</span>
                    </p>
                  )}
                  {isActiveSpaces && (
                    <p className="mt-1 text-xs text-gray-600">
                      FTL realm server host · default port <span className="text-gray-400">8080</span>
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Port</label>
                  <input
                    className="input"
                    type="number"
                    value={form.port}
                    onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Scheme</label>
                <div className="flex gap-2">
                  {(['http', 'https'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, scheme: s }))}
                      className={cn(
                        'flex-1 py-1.5 rounded text-sm font-medium border transition-colors',
                        form.scheme === s
                          ? 'bg-accent border-accent text-white'
                          : 'bg-surface-200 border-border text-gray-400 hover:text-gray-100'
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  {isActiveSpaces ? 'Grid Name' : 'API Key'}{' '}
                  {isPinecone ? <span className="text-red-400">*</span> : <span className="text-gray-600">(optional)</span>}
                </label>
                <input
                  className="input font-mono"
                  type={isActiveSpaces ? 'text' : 'password'}
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder={
                    isPinecone ? 'Pinecone API key'
                    : isActiveSpaces ? 'Leave blank for _default grid'
                    : 'Leave blank for anonymous access'
                  }
                  required={isPinecone}
                />
              </div>

              {/* Advanced */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <Globe className="w-3.5 h-3.5" />
                  Advanced — proxy settings
                  <span className="text-gray-700">{showAdvanced ? '▲' : '▼'}</span>
                </button>
                {showAdvanced && (
                  <div className="mt-2">
                    <label className="block text-xs font-medium text-gray-400 mb-1">Proxy URL</label>
                    <input
                      className="input font-mono text-sm"
                      value={form.proxyURL ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, proxyURL: e.target.value }))}
                      placeholder="/api/weaviate"
                    />
                    <p className="mt-1 text-xs text-gray-600">
                      <code className="font-mono text-gray-500">/api/weaviate</code> routes through the built-in proxy (avoids CORS).
                      Clear to connect directly to the host above.
                    </p>
                  </div>
                )}
              </div>

              {/* URL preview */}
              <div className="flex items-center gap-2 px-3 py-2 bg-surface-300 rounded text-xs font-mono text-gray-400">
                <Server className="w-3.5 h-3.5 flex-shrink-0 text-gray-600" />
                <span className="truncate">{buildBaseURL(form)}</span>
                {form.proxyURL?.startsWith('/') && (
                  <span className="ml-auto text-gray-600 font-sans whitespace-nowrap">→ {form.scheme}://{form.host}:{form.port}</span>
                )}
              </div>

              {error && (
                <div className="p-3 bg-red-900/20 border border-red-800 rounded-md space-y-1">
                  <div className="flex items-start gap-2 text-sm text-red-400">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{error.message}</span>
                  </div>
                  {error.hint && (
                    <p className="text-xs text-red-400/70 pl-6">{error.hint}</p>
                  )}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2">
                {loading && connectingIdx === null ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {loading && connectingIdx === null ? 'Connecting…' : `Connect to ${selectedDB.label}`}
              </button>

              <p className="text-xs text-gray-600 text-center">
                {isPinecone
                  ? <>Create a free index at <span className="text-gray-400">app.pinecone.io</span></>
                  : isPgvector
                  ? <>Requires <span className="text-gray-400">PostgREST</span> in front of Postgres · <code className="font-mono text-gray-500">postgrest postgrest.conf</code></>
                  : isActiveSpaces
                  ? <>Requires the <span className="text-gray-400">AS REST bridge</span> running · <code className="font-mono text-gray-500">cd bridge &amp;&amp; start.bat</code></>
                  : <>Start locally: <code className="font-mono text-gray-400">docker compose{form.dbType !== 'weaviate' ? ` --profile ${form.dbType}` : ''} up -d</code></>
                }
              </p>

              {savedConnections.length === 0 && (
                <p className="text-xs text-gray-600 text-center">
                  Connections are saved automatically on success — they'll appear here next time.
                </p>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
