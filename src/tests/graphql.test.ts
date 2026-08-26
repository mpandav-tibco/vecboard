/**
 * Unit tests for src/lib/weaviate/graphql.ts
 * Tests GraphQL query builders, escaping, and result extraction (fetch mocked).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nearVectorSearch, bm25Search, hybridSearch, semanticSearch } from '@/lib/weaviate/graphql'

const mockFetch = vi.fn()

beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset() })
afterEach(() => { vi.unstubAllGlobals() })

function gqlRes(className: string, items: unknown[]) {
  return new Response(
    JSON.stringify({ data: { Get: { [className]: items } } }),
    { status: 200 }
  )
}

function gqlItem(content: string, id = 'id-001', opts: Record<string, unknown> = {}) {
  return {
    content,
    _additional: { id, score: 0.9, certainty: 0.95, distance: 0.05, ...opts },
  }
}

function lastQuery(): string {
  const body = JSON.parse((mockFetch.mock.calls.at(-1)![1] as RequestInit).body as string) as { query: string }
  return body.query
}

// ── nearVectorSearch ──────────────────────────────────────────────────────────

describe('nearVectorSearch', () => {
  it('maps results from GraphQL response correctly', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', [gqlItem('hello')]))
    const results = await nearVectorSearch({ className: 'Docs', vector: [0.1, 0.2], limit: 5, properties: ['content'], config: null })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('id-001')
    expect(results[0].properties.content).toBe('hello')
    expect(results[0].certainty).toBe(0.95)
    expect(results[0].distance).toBe(0.05)
    expect(results[0].class).toBe('Docs')
  })

  it('_additional fields are NOT included in properties', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', [gqlItem('text')]))
    const results = await nearVectorSearch({ className: 'Docs', vector: [], limit: 5, properties: ['content'], config: null })
    expect(results[0].properties).not.toHaveProperty('_additional')
  })

  it('sends nearVector with correct vector in query', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', []))
    await nearVectorSearch({ className: 'Docs', vector: [1, 2, 3], limit: 10, properties: ['content'], config: null })
    const q = lastQuery()
    expect(q).toContain('nearVector')
    expect(q).toContain('1,2,3')
    expect(q).toContain('limit: 10')
  })

  it('returns empty array when no results', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', []))
    const results = await nearVectorSearch({ className: 'Docs', vector: [], limit: 5, properties: ['content'], config: null })
    expect(results).toEqual([])
  })

  it('throws when GraphQL response contains errors', async () => {
    mockFetch.mockResolvedValue(new Response(
      JSON.stringify({ errors: [{ message: 'Unknown argument nearText' }] }),
      { status: 200 }
    ))
    await expect(nearVectorSearch({ className: 'Docs', vector: [], limit: 5, properties: [], config: null }))
      .rejects.toThrow('Unknown argument nearText')
  })

  it('includes where clause when filter provided', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', []))
    await nearVectorSearch({
      className: 'Docs', vector: [], limit: 5, properties: ['content'], config: null,
      filters: [{ path: 'source', operator: 'Equal', valueType: 'valueText', value: 'wiki' }],
    })
    const q = lastQuery()
    expect(q).toContain('where')
    expect(q).toContain('Equal')
    expect(q).toContain('"wiki"')
  })

  it('includes multiple properties in selection', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', []))
    await nearVectorSearch({ className: 'Docs', vector: [], limit: 5, properties: ['content', 'title', 'source'], config: null })
    const q = lastQuery()
    expect(q).toContain('content')
    expect(q).toContain('title')
    expect(q).toContain('source')
  })
})

// ── bm25Search ────────────────────────────────────────────────────────────────

describe('bm25Search', () => {
  it('returns results for keyword query', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', [gqlItem('keyword hit', 'id-002', { score: 1.5, explainScore: 'BM25 score' })]))
    const results = await bm25Search({ className: 'Docs', query: 'keyword', limit: 10, properties: ['content'], config: null })
    expect(results).toHaveLength(1)
    expect(results[0].properties.content).toBe('keyword hit')
    expect(results[0].explainScore).toBe('BM25 score')
  })

  it('sends bm25 query with correct className and limit', async () => {
    mockFetch.mockResolvedValue(gqlRes('Articles', []))
    await bm25Search({ className: 'Articles', query: 'search term', limit: 3, properties: ['content'], config: null })
    const q = lastQuery()
    expect(q).toContain('bm25')
    expect(q).toContain('Articles')
    expect(q).toContain('limit: 3')
  })

  it('escapes double quotes in query string', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', []))
    await bm25Search({ className: 'Docs', query: '"quoted term"', limit: 5, properties: ['content'], config: null })
    const q = lastQuery()
    expect(q).toContain('\\"quoted term\\"')
  })

  it('escapes backslashes in query string', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', []))
    await bm25Search({ className: 'Docs', query: 'path\\to\\file', limit: 5, properties: ['content'], config: null })
    const q = lastQuery()
    expect(q).toContain('path\\\\to\\\\file')
  })

  it('escapes newlines inside the bm25 query string value', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', []))
    await bm25Search({ className: 'Docs', query: 'line\nbreak', limit: 5, properties: ['content'], config: null })
    const q = lastQuery()
    // The raw GraphQL query template itself has real newlines for formatting;
    // what we verify is that the user's \n was escaped to \\n inside the bm25 query value
    expect(q).toContain('line\\nbreak')
  })

  it('throws when GraphQL returns errors', async () => {
    mockFetch.mockResolvedValue(new Response(
      JSON.stringify({ errors: [{ message: 'BM25 not enabled' }] }),
      { status: 200 }
    ))
    await expect(bm25Search({ className: 'Docs', query: 'test', limit: 5, properties: [], config: null }))
      .rejects.toThrow('BM25 not enabled')
  })
})

// ── hybridSearch ──────────────────────────────────────────────────────────────

describe('hybridSearch', () => {
  it('includes alpha and vector in query when vector provided', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', []))
    await hybridSearch({ className: 'Docs', query: 'hello', vector: [0.1, 0.2], alpha: 0.75, limit: 5, properties: ['content'], config: null })
    const q = lastQuery()
    expect(q).toContain('hybrid')
    expect(q).toContain('alpha: 0.75')
    expect(q).toContain('0.1,0.2')
  })

  it('omits vector part when vector is undefined', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', []))
    await hybridSearch({ className: 'Docs', query: 'hello', vector: undefined, alpha: 0.5, limit: 5, properties: ['content'], config: null })
    const q = lastQuery()
    expect(q).not.toContain('vector:')
  })

  it('omits vector part when vector is empty array', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', []))
    await hybridSearch({ className: 'Docs', query: 'hello', vector: [], alpha: 0.5, limit: 5, properties: ['content'], config: null })
    const q = lastQuery()
    expect(q).not.toContain('vector:')
  })

  it('returns mapped results', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', [gqlItem('hybrid result')]))
    const results = await hybridSearch({ className: 'Docs', query: 'q', vector: [1], alpha: 0.5, limit: 5, properties: ['content'], config: null })
    expect(results[0].properties.content).toBe('hybrid result')
  })
})

// ── semanticSearch (nearText) ─────────────────────────────────────────────────

describe('semanticSearch', () => {
  it('sends nearText query with concepts', async () => {
    mockFetch.mockResolvedValue(gqlRes('Docs', []))
    await semanticSearch({ className: 'Docs', concepts: ['machine learning'], limit: 5, properties: ['content'], config: null })
    const q = lastQuery()
    expect(q).toContain('nearText')
    expect(q).toContain('machine learning')
  })

  it('uses certainty for score when available', async () => {
    const item = { content: 'text', _additional: { id: 'x', certainty: 0.88, distance: 0.12 } }
    mockFetch.mockResolvedValue(gqlRes('Docs', [item]))
    const results = await semanticSearch({ className: 'Docs', concepts: ['ai'], limit: 5, properties: ['content'], config: null })
    expect(results[0].certainty).toBe(0.88)
    expect(results[0].distance).toBe(0.12)
  })
})
