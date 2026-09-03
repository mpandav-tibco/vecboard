/**
 * Unit tests for src/lib/adapters/index.ts — getAdapter factory.
 */
import { describe, it, expect } from 'vitest'
import { getAdapter } from '@/lib/adapters'
import { WeaviateAdapter } from '@/lib/adapters/weaviate'
import { QdrantAdapter } from '@/lib/adapters/qdrant'
import { ChromaAdapter } from '@/lib/adapters/chroma'
import { PineconeAdapter } from '@/lib/adapters/pinecone'
import { PgvectorAdapter } from '@/lib/adapters/pgvector'
import { ActiveSpacesAdapter } from '@/lib/adapters/activespaces'
import type { ConnectionConfig } from '@/types/domain'

function cfg(dbType: ConnectionConfig['dbType']): ConnectionConfig {
  return { dbType, host: 'localhost', port: 1234, scheme: 'http' }
}

describe('getAdapter', () => {
  it('returns WeaviateAdapter for dbType "weaviate"', () => {
    expect(getAdapter(cfg('weaviate'))).toBeInstanceOf(WeaviateAdapter)
  })

  it('returns QdrantAdapter for dbType "qdrant"', () => {
    expect(getAdapter(cfg('qdrant'))).toBeInstanceOf(QdrantAdapter)
  })

  it('returns ChromaAdapter for dbType "chroma"', () => {
    expect(getAdapter(cfg('chroma'))).toBeInstanceOf(ChromaAdapter)
  })

  it('returns PineconeAdapter for dbType "pinecone"', () => {
    expect(getAdapter(cfg('pinecone'))).toBeInstanceOf(PineconeAdapter)
  })

  it('returns PgvectorAdapter for dbType "pgvector"', () => {
    expect(getAdapter(cfg('pgvector'))).toBeInstanceOf(PgvectorAdapter)
  })

  it('returns ActiveSpacesAdapter for dbType "activespaces"', () => {
    expect(getAdapter(cfg('activespaces'))).toBeInstanceOf(ActiveSpacesAdapter)
  })

  it('throws for an unsupported dbType', () => {
    expect(() => getAdapter(cfg('mystery' as ConnectionConfig['dbType']))).toThrow(/not yet supported/i)
  })

  it('each call returns a fresh adapter instance', () => {
    const a = getAdapter(cfg('qdrant'))
    const b = getAdapter(cfg('qdrant'))
    expect(a).not.toBe(b)
  })
})
