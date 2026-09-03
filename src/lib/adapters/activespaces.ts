import type { ConnectionConfig, SearchResult, FilterCondition } from '@/types/domain'
import type { DBAdapter, DBCollection, DBObject, DBHealthStatus, CreateCollectionInput, BatchResult } from './types'

// ActiveSpaces adapter — communicates with the AS REST bridge (bridge/ASBridge.java).
//
// Connection config usage:
//   host + port + scheme  → FTL realm server URL sent as X-AS-Realm-URL header
//   apiKey                → grid name sent as X-AS-Grid-Name header (optional)
//   proxyURL              → bridge base URL, defaults to /api/activespaces

export class ActiveSpacesAdapter implements DBAdapter {
  private baseURL: string
  private headers: Record<string, string>

  constructor(private config: ConnectionConfig) {
    this.baseURL = (config.proxyURL ?? '/api/activespaces').replace(/\/$/, '')
    this.headers = {
      'Content-Type': 'application/json',
      'X-AS-Realm-URL': `${config.scheme}://${config.host}:${config.port}`,
    }
    if (config.apiKey) this.headers['X-AS-Grid-Name'] = config.apiKey
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseURL}${path}`, {
      ...init,
      headers: { ...this.headers, ...((init?.headers as Record<string, string>) ?? {}) },
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try { msg = (JSON.parse(text) as { error?: string }).error ?? msg } catch {}
      throw new Error(msg)
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error(`ActiveSpaces bridge returned non-JSON (HTTP ${res.status}) — is the bridge running on port 9090?`)
    }
  }

  async checkHealth(): Promise<DBHealthStatus> {
    try {
      const data = await this.req<{ ready: boolean; version?: string; gridName?: string }>('/health')
      const ver = [data.version, data.gridName].filter(Boolean).join(' / ')
      return { ready: data.ready, version: ver || 'ActiveSpaces 5.x' }
    } catch (e) {
      return { ready: false, error: e instanceof Error ? e.message : 'Connection failed' }
    }
  }

  async listCollections(): Promise<DBCollection[]> {
    const data = await this.req<Array<{
      name: string
      objectCount?: number
      vectorDimensions?: number
      distance?: string
      properties?: Array<{ name: string; dataType: string }>
    }>>('/tables')
    return data.map((t) => ({
      name: t.name,
      objectCount: t.objectCount,
      vectorDimensions: t.vectorDimensions,
      distance: t.distance,
      properties: t.properties?.map((p) => ({ name: p.name, dataType: p.dataType })),
    }))
  }

  async getCollection(name: string): Promise<DBCollection> {
    const t = await this.req<{
      name: string
      objectCount?: number
      vectorDimensions?: number
      distance?: string
      properties?: Array<{ name: string; dataType: string }>
    }>(`/tables/${encodeURIComponent(name)}`)
    return {
      name: t.name,
      objectCount: t.objectCount,
      vectorDimensions: t.vectorDimensions,
      distance: t.distance,
      properties: t.properties?.map((p) => ({ name: p.name, dataType: p.dataType })),
    }
  }

  async createCollection(input: CreateCollectionInput): Promise<void> {
    await this.req('/tables', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        vectorDimensions: input.vectorDimensions ?? 768,
        distance: input.distance ?? 'cosine',
        properties: input.properties ?? [],
      }),
    })
  }

  async deleteCollection(name: string): Promise<void> {
    await this.req(`/tables/${encodeURIComponent(name)}`, { method: 'DELETE' })
  }

  async getObjectCount(name: string): Promise<number> {
    const col = await this.getCollection(name)
    return col.objectCount ?? 0
  }

  async listObjects(
    collection: string, limit: number, offset: number,
  ): Promise<{ objects: DBObject[]; total: number }> {
    return this.req(`/tables/${encodeURIComponent(collection)}/rows?limit=${limit}&offset=${offset}`)
  }

  async createObject(
    collection: string, properties: Record<string, unknown>, vector?: number[],
  ): Promise<string> {
    const data = await this.req<{ id: string }>(`/tables/${encodeURIComponent(collection)}/rows`, {
      method: 'POST',
      body: JSON.stringify({ properties, vector }),
    })
    return data.id
  }

  async deleteObject(collection: string, id: string): Promise<void> {
    await this.req(`/tables/${encodeURIComponent(collection)}/rows/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  async vectorSearch(
    collection: string, vector: number[], limit: number,
    _properties?: string[], _filters?: FilterCondition[],
  ): Promise<SearchResult[]> {
    return this.req(`/tables/${encodeURIComponent(collection)}/search/vector`, {
      method: 'POST',
      body: JSON.stringify({ vector, limit }),
    })
  }

  async keywordSearch(
    collection: string, query: string, limit: number, properties?: string[],
    _filters?: FilterCondition[],
  ): Promise<SearchResult[]> {
    return this.req(`/tables/${encodeURIComponent(collection)}/search/keyword`, {
      method: 'POST',
      body: JSON.stringify({ query, limit, properties }),
    })
  }

  async hybridSearch(
    collection: string, query: string, vector: number[] | undefined,
    _alpha: number, limit: number, properties?: string[],
  ): Promise<SearchResult[]> {
    if (vector) return this.vectorSearch(collection, vector, limit, properties)
    return this.keywordSearch(collection, query, limit, properties)
  }

  async batchInsert(
    collection: string,
    objects: Array<{ id?: string; properties: Record<string, unknown>; vector?: number[] }>,
  ): Promise<BatchResult> {
    try {
      return await this.req(`/tables/${encodeURIComponent(collection)}/batch`, {
        method: 'POST',
        body: JSON.stringify({ objects }),
      })
    } catch (e) {
      return { success: 0, errors: [e instanceof Error ? e.message : 'Batch insert failed'] }
    }
  }
}
