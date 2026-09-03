import { useState, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import type { SearchLogEntry } from '@/store/appStore'
import { ArrowLeft, Plus, Trash2, RefreshCw, Eye, ChevronLeft, ChevronRight, Loader2, Copy, Search, CheckSquare, Square, X, BarChart2, Download } from 'lucide-react'
import { useCollection, useObjectCount } from '@/hooks/useCollections'
import { useObjects, useCreateObject, useDeleteObject } from '@/hooks/useObjects'
import { formatNumber, truncate, formatDate, formatDuration } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'
import type { DBObject } from '@/lib/adapters'
import { VectorViz } from '@/components/VectorViz'
import { getAdapter } from '@/lib/adapters'
import { useConnectionStore } from '@/store/connectionStore'

function VectorPreview({ vector }: { vector: number[] }) {
  const preview = vector.slice(0, 20)
  const max = Math.max(...preview.map(Math.abs))
  return (
    <div className="flex items-end gap-0.5 h-6">
      {preview.map((v, i) => (
        <div
          key={i}
          className={cn('w-1.5 rounded-sm', v >= 0 ? 'bg-accent' : 'bg-red-500')}
          style={{ height: `${Math.abs(v / max) * 100}%`, minHeight: '2px', opacity: 0.7 }}
          title={v.toFixed(4)}
        />
      ))}
      {vector.length > 20 && <span className="text-gray-600 text-xs ml-1">+{vector.length - 20}</span>}
    </div>
  )
}

function ObjectDetailModal({ obj, onClose, onDelete }: {
  obj: { id: string; class: string; properties: Record<string, unknown>; vector?: number[] }
  onClose: () => void
  onDelete: (id: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<'properties' | 'raw' | 'vector'>('properties')

  const copy = () => {
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] bg-surface-100 border border-border rounded-xl flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="min-w-0 flex-1 mr-4">
            <p className="text-sm font-semibold text-gray-100">Object Detail</p>
            <p className="text-xs font-mono text-gray-500 mt-0.5 break-all">{obj.id}</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={copy}
              title={copied ? 'Copied!' : 'Copy full object as JSON'}
              className="btn-ghost p-1.5 text-xs flex items-center gap-1"
            >
              {copied ? <span className="text-green-400 text-xs">✓ Copied</span> : <><Copy className="w-3.5 h-3.5" /><span className="text-xs">Copy</span></>}
            </button>
            <button
              onClick={() => onDelete(obj.id)}
              title="Delete this object permanently"
              className="btn-ghost p-1.5 text-red-500 flex items-center gap-1 text-xs"
            >
              <Trash2 className="w-3.5 h-3.5" /><span>Delete</span>
            </button>
            <button
              onClick={onClose}
              title="Close (Esc)"
              className="btn-ghost p-1.5 text-gray-400 hover:text-gray-100 text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-border flex-shrink-0">
          {(['properties', 'raw', ...(obj.vector ? ['vector'] : [])] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t as typeof tab)}
              title={t === 'properties' ? 'View individual property values' : t === 'raw' ? 'View complete raw JSON object' : `View embedding vector (${obj.vector?.length} dimensions)`}
              className={cn(
                'px-5 py-2.5 text-xs font-medium capitalize border-b-2 -mb-px transition-colors',
                tab === t ? 'border-accent text-accent' : 'border-transparent text-gray-400 hover:text-gray-100'
              )}
            >
              {t === 'vector' ? `Vector (${obj.vector?.length}d)` : t === 'raw' ? 'Raw JSON' : 'Properties'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'properties' && (
            <div className="space-y-3">
              {Object.entries(obj.properties).map(([key, val]) => (
                <div key={key} className="bg-surface-200 rounded-lg px-4 py-3">
                  <p className="text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">{key}</p>
                  <p className="text-sm text-gray-200 whitespace-pre-wrap break-words leading-relaxed">
                    {typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? '—')}
                  </p>
                </div>
              ))}
              {Object.keys(obj.properties).length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">No properties</p>
              )}
            </div>
          )}

          {tab === 'raw' && (
            <pre className="text-xs font-mono text-gray-300 leading-relaxed whitespace-pre-wrap break-words bg-surface-200 rounded-lg p-4">
              {JSON.stringify(obj, null, 2)}
            </pre>
          )}

          {tab === 'vector' && obj.vector && (
            <div className="space-y-4">
              <VectorPreview vector={obj.vector} />
              <div className="bg-surface-200 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-2">First 16 dimensions</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {obj.vector.slice(0, 16).map((v, i) => (
                    <div key={i} className="flex items-center justify-between text-xs font-mono bg-surface-300 rounded px-2 py-1">
                      <span className="text-gray-500">[{i}]</span>
                      <span className={v >= 0 ? 'text-accent' : 'text-red-400'}>{v.toFixed(6)}</span>
                    </div>
                  ))}
                </div>
                {obj.vector.length > 16 && (
                  <p className="text-xs text-gray-600 mt-2 text-center">… and {obj.vector.length - 16} more dimensions</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function CollectionDetailPage() {
  const { name = '' } = useParams()
  const navigate = useNavigate()
  const { data: collection, isLoading: colLoading } = useCollection(name)
  const { data: count } = useObjectCount(name)

  const [page, setPage] = useState(0)
  const PAGE_SIZE = 25
  const { data: objectsData, isLoading: objLoading, refetch } = useObjects(name, PAGE_SIZE, page * PAGE_SIZE)
  const createObject = useCreateObject()
  const deleteObject = useDeleteObject()
  const connectionConfig = useConnectionStore((s) => s.config)

  const [selectedObj, setSelectedObj] = useState<DBObject | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newProps, setNewProps] = useState('{\n  "content": ""\n}')
  const { vizHighlight, searchLog, clearSearchLog } = useAppStore()
  const [activeTab, setActiveTab] = useState<'schema' | 'objects' | 'visualize' | 'analytics'>(
    () => vizHighlight?.collectionName === name ? 'visualize' : 'objects'
  )

  const collectionLog = useMemo(
    () => searchLog.filter((e: SearchLogEntry) => e.collectionName === name),
    [searchLog, name]
  )

  // Filter + multi-select state
  const [filterText, setFilterText] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)

  // Export state
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  const filteredObjects = useMemo(() => {
    const objs = objectsData?.objects ?? []
    if (!filterText.trim()) return objs
    const q = filterText.trim().toLowerCase()
    return objs.filter((obj) =>
      obj.id.toLowerCase().includes(q) ||
      JSON.stringify(obj.properties).toLowerCase().includes(q)
    )
  }, [objectsData?.objects, filterText])

  const allFilteredIds = filteredObjects.map((o) => o.id)
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id))
  const someSelected = selectedIds.size > 0

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (allSelected) return new Set()
      return new Set(allFilteredIds)
    })
  }, [allSelected, allFilteredIds])

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const props = JSON.parse(newProps)
      await createObject.mutateAsync({ className: name, properties: props })
      setShowCreate(false)
      setNewProps('{\n  "content": ""\n}')
      refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Invalid JSON')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this object?')) return
    await deleteObject.mutateAsync({ className: name, id })
    setSelectedObj(null)
    refetch()
  }

  const handleBulkDelete = async () => {
    const ids = [...selectedIds]
    if (!confirm(`Delete ${ids.length} selected object${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return
    setBulkDeleting(true)
    setBulkProgress({ done: 0, total: ids.length })
    const adapter = connectionConfig ? getAdapter(connectionConfig) : null
    let done = 0
    for (const id of ids) {
      try {
        if (adapter) await adapter.deleteObject(name, id)
        else await deleteObject.mutateAsync({ className: name, id })
      } catch {
        // continue best-effort
      }
      done++
      setBulkProgress({ done, total: ids.length })
    }
    setSelectedIds(new Set())
    setBulkDeleting(false)
    setBulkProgress(null)
    refetch()
  }

  const exportCollection = async (format: 'json' | 'jsonl' | 'csv') => {
    if (!connectionConfig) return
    setShowExportMenu(false)
    setExporting(true)
    try {
      const adapter = getAdapter(connectionConfig)
      const allObjects: DBObject[] = []
      let offset = 0
      const LIMIT = 200
      const total = count ?? 0
      setExportProgress({ done: 0, total })
      while (true) {
        const { objects } = await adapter.listObjects(name, LIMIT, offset)
        if (objects.length === 0) break
        allObjects.push(...objects)
        offset += objects.length
        setExportProgress({ done: allObjects.length, total })
        if (objects.length < LIMIT) break
      }

      let content: string
      let filename: string
      let mime: string

      const toFlat = (o: DBObject) => ({ id: o.id, ...o.properties, ...(o.vector ? { _vector: o.vector } : {}) })

      if (format === 'json') {
        content = JSON.stringify(allObjects.map(toFlat), null, 2)
        filename = `${name}.json`
        mime = 'application/json'
      } else if (format === 'jsonl') {
        content = allObjects.map((o) => JSON.stringify(toFlat(o))).join('\n')
        filename = `${name}.jsonl`
        mime = 'application/x-ndjson'
      } else {
        const propKeys = [...new Set(allObjects.flatMap((o) => Object.keys(o.properties)))]
        const headers = ['id', ...propKeys]
        const csvCell = (v: unknown) => {
          const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
          return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
        }
        const rows = allObjects.map((o) =>
          headers.map((h) => csvCell(h === 'id' ? o.id : o.properties[h])).join(',')
        )
        content = [headers.join(','), ...rows].join('\n')
        filename = `${name}.csv`
        mime = 'text/csv'
      }

      const blob = new Blob([content], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
  }

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/collections')} title="Back to Collections" className="btn-ghost p-1.5">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="text-lg font-semibold font-mono text-gray-100">{name}</h2>
          <p className="text-xs text-gray-500">{formatNumber(count ?? 0)} objects</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['objects', 'schema', 'visualize', 'analytics'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={cn('px-4 py-2 text-sm capitalize transition-colors border-b-2 -mb-px', activeTab === t
              ? 'border-accent text-accent font-medium'
              : 'border-transparent text-gray-400 hover:text-gray-100')}
          >
            {t === 'analytics'
              ? <>Analytics{collectionLog.length > 0 && <span className="ml-1.5 text-[10px] bg-accent-muted text-accent rounded-full px-1.5 py-0.5">{collectionLog.length}</span>}</>
              : t}
          </button>
        ))}
      </div>

      {/* Schema tab */}
      {activeTab === 'schema' && !colLoading && collection && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Property</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Type</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium cursor-help" title="Property is included in BM25 keyword and hybrid search">Searchable</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium cursor-help" title="Property can be used in where-clause filters">Filterable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {collection.properties?.map((p) => (
                <tr key={p.name} className="hover:bg-surface-200">
                  <td className="px-4 py-2 font-mono text-gray-200">{p.name}</td>
                  <td className="px-4 py-2">
                    <span className="badge bg-surface-300 text-gray-300">{p.dataType}</span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{p.searchable ? '✓' : '—'}</td>
                  <td className="px-4 py-2 text-gray-500">{p.filterable ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-border bg-surface-200 text-xs text-gray-500">
            Distance: <span className="text-gray-300">{collection.distance ?? 'cosine'}</span>
            {collection.vectorDimensions && <>{' · '}Dimensions: <span className="text-gray-300">{collection.vectorDimensions}</span></>}
            {collection.vectorizer && <>{' · '}Vectorizer: <span className="text-gray-300">{collection.vectorizer}</span></>}
          </div>
        </div>
      )}

      {/* Objects tab */}
      {activeTab === 'objects' && (
        <>
          <div className="flex items-center gap-2">
            {/* Filter input */}
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
              <input
                type="text"
                className="input pl-8 pr-8 text-xs h-8 w-full"
                placeholder="Filter by id or property value…"
                value={filterText}
                onChange={(e) => { setFilterText(e.target.value); setSelectedIds(new Set()) }}
                title="Filter visible rows by id or property content (case-insensitive)"
              />
              {filterText && (
                <button
                  onClick={() => { setFilterText(''); setSelectedIds(new Set()) }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  title="Clear filter"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Bulk delete button */}
            {someSelected && (
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                title={`Delete ${selectedIds.size} selected object${selectedIds.size === 1 ? '' : 's'}`}
                className="btn-ghost text-xs text-red-500 border border-red-900/50 hover:bg-red-900/20 flex-shrink-0"
              >
                {bulkDeleting && bulkProgress
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {bulkProgress.done}/{bulkProgress.total}</>
                  : <><Trash2 className="w-3.5 h-3.5" /> Delete {selectedIds.size}</>
                }
              </button>
            )}

            <p className="text-xs text-gray-500 flex-shrink-0">
              {filterText
                ? `${filteredObjects.length} of ${objectsData?.objects?.length ?? 0} shown`
                : `Page ${page + 1} of ${totalPages || 1}`
              }
            </p>
            <button onClick={() => refetch()} title="Reload objects" className="btn-ghost text-xs flex-shrink-0"><RefreshCw className="w-3.5 h-3.5" /></button>

            {/* Export dropdown */}
            <div className="relative flex-shrink-0" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu((v) => !v)}
                disabled={exporting}
                title="Export all objects as JSON, JSONL, or CSV"
                className="btn-secondary text-xs"
              >
                {exporting && exportProgress
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {exportProgress.done}/{exportProgress.total}</>
                  : <><Download className="w-3.5 h-3.5" /> Export</>
                }
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-surface-100 border border-border rounded-lg shadow-xl overflow-hidden min-w-[100px]">
                  {(['json', 'jsonl', 'csv'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => exportCollection(fmt)}
                      className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-surface-200 hover:text-gray-100 transition-colors font-mono"
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button onClick={() => setShowCreate(true)} title="Add a new object to this collection" className="btn-primary text-xs flex-shrink-0">
              <Plus className="w-3.5 h-3.5" /> New Object
            </button>
          </div>

          <div className="card overflow-hidden">
            {objLoading && <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>}
            {!objLoading && filteredObjects.length === 0 && (
              <p className="py-8 text-center text-sm text-gray-500">
                {filterText ? 'No objects match the filter' : 'No objects in this collection'}
              </p>
            )}
            {!objLoading && filteredObjects.length > 0 && (
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 py-3 w-8">
                      <button
                        onClick={toggleAll}
                        title={allSelected ? 'Deselect all visible' : 'Select all visible'}
                        className="text-gray-500 hover:text-gray-200 transition-colors"
                      >
                        {allSelected
                          ? <CheckSquare className="w-4 h-4 text-accent" />
                          : someSelected
                            ? <CheckSquare className="w-4 h-4 text-gray-600" />
                            : <Square className="w-4 h-4" />
                        }
                      </button>
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium w-44">ID</th>
                    <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Properties</th>
                    <th className="px-4 py-3 text-xs text-gray-500 font-medium text-right w-20">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredObjects.map((obj) => {
                    const isSelected = selectedIds.has(obj.id)
                    return (
                      <tr
                        key={obj.id}
                        className={cn('group hover:bg-surface-200', isSelected && 'bg-accent/5')}
                      >
                        <td className="px-3 py-2">
                          <button
                            onClick={() => toggleOne(obj.id)}
                            title={isSelected ? 'Deselect' : 'Select'}
                            className="text-gray-500 hover:text-gray-200 transition-colors"
                          >
                            {isSelected
                              ? <CheckSquare className="w-4 h-4 text-accent" />
                              : <Square className="w-4 h-4" />
                            }
                          </button>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-500 w-40" title={obj.id}>{truncate(obj.id, 12)}…</td>
                        <td className="px-4 py-2 text-gray-300 text-xs">
                          {truncate(JSON.stringify(obj.properties), 80)}
                        </td>
                        <td className="px-4 py-2 text-right w-20">
                          <div className="flex justify-end gap-1 transition-opacity opacity-0 group-hover:opacity-100">
                            <button onClick={() => setSelectedObj(obj as any)} title="View full object details" className="btn-ghost p-1">
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(obj.id)} title="Delete this object permanently" className="btn-ghost p-1 text-red-500">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {!filterText && (
            <div className="flex items-center justify-between">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} title="Go to previous page" className="btn-secondary text-xs disabled:opacity-30">
                <ChevronLeft className="w-3.5 h-3.5" /> Previous
              </button>
              <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} title="Go to next page" className="btn-secondary text-xs disabled:opacity-30">
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </>
      )}

      {/* Visualize tab */}
      {activeTab === 'visualize' && (
        <VectorViz collectionName={name} />
      )}

      {/* Analytics tab */}
      {activeTab === 'analytics' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-gray-500" />
              <p className="text-sm text-gray-300 font-medium">Search query log</p>
              <span className="text-xs text-gray-500">— session only, not persisted</span>
            </div>
            {collectionLog.length > 0 && (
              <button onClick={clearSearchLog} className="text-xs text-gray-600 hover:text-red-400 flex items-center gap-1 transition-colors">
                <Trash2 className="w-3 h-3" /> Clear all
              </button>
            )}
          </div>

          {collectionLog.length === 0 ? (
            <div className="card p-6 text-center text-sm text-gray-500">
              No queries run against <span className="font-mono text-gray-400">{name}</span> this session.
              <p className="text-xs text-gray-600 mt-1">Run a search from the Search page and results will appear here.</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-200">
                    <th className="text-left px-4 py-2 text-gray-500 font-medium">Query</th>
                    <th className="text-left px-4 py-2 text-gray-500 font-medium">Type</th>
                    <th className="text-left px-4 py-2 text-gray-500 font-medium text-right">Results</th>
                    <th className="text-left px-4 py-2 text-gray-500 font-medium text-right">Top score</th>
                    <th className="text-left px-4 py-2 text-gray-500 font-medium text-right">Duration</th>
                    <th className="text-left px-4 py-2 text-gray-500 font-medium text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {collectionLog.map((entry: SearchLogEntry) => (
                    <tr key={entry.id} className="hover:bg-surface-200">
                      <td className="px-4 py-2 text-gray-200 max-w-[200px]" title={entry.query}>
                        {truncate(entry.query, 40)}
                      </td>
                      <td className="px-4 py-2">
                        <span className="badge bg-surface-300 text-gray-400">{entry.searchType}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-400 text-right tabular-nums">{entry.resultCount}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {entry.topScore !== undefined
                          ? <span className="text-accent">{entry.topScore.toFixed(4)}</span>
                          : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="px-4 py-2 text-gray-400 text-right tabular-nums">{formatDuration(entry.durationMs)}</td>
                      <td className="px-4 py-2 text-gray-600 text-right">{formatDate(entry.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {collectionLog.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                ['Total queries', collectionLog.length],
                ['Avg results', Math.round(collectionLog.reduce((s, e) => s + e.resultCount, 0) / collectionLog.length)],
                ['Avg duration', formatDuration(Math.round(collectionLog.reduce((s, e) => s + e.durationMs, 0) / collectionLog.length))],
              ].map(([label, value]) => (
                <div key={label as string} className="card p-3 text-center">
                  <p className="text-lg font-bold text-gray-100">{value}</p>
                  <p className="text-xs text-gray-500">{label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Object detail modal */}
      {selectedObj && (
        <ObjectDetailModal obj={selectedObj as any} onClose={() => setSelectedObj(null)} onDelete={handleDelete} />
      )}

      {/* Create object modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-2xl p-6 space-y-4">
            <div>
              <h3 className="font-semibold text-gray-100">New Object</h3>
              <p className="text-xs text-gray-500 mt-0.5">Enter properties as a JSON object. The vector will be generated or left empty depending on the collection's vectorizer.</p>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1" title="A valid JSON object mapping property names to values">
                  Properties (JSON)
                </label>
                <textarea
                  className="input font-mono text-sm h-56 resize-y"
                  value={newProps}
                  onChange={(e) => setNewProps(e.target.value)}
                  spellCheck={false}
                  title="Enter property values as a JSON object"
                  placeholder={'{\n  "title": "My document",\n  "content": "Text content here"\n}'}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreate(false)} title="Discard and close" className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createObject.isPending} title="Save object to Weaviate" className="btn-primary">
                  {createObject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
