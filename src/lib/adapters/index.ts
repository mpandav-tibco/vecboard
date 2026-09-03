import type { ConnectionConfig } from '@/types/domain'
import { WeaviateAdapter } from './weaviate'
import { QdrantAdapter } from './qdrant'
import { ChromaAdapter } from './chroma'
import { PineconeAdapter } from './pinecone'
import { PgvectorAdapter } from './pgvector'
import { ActiveSpacesAdapter } from './activespaces'
import type { DBAdapter } from './types'

export function getAdapter(config: ConnectionConfig): DBAdapter {
  switch (config.dbType) {
    case 'weaviate':      return new WeaviateAdapter(config)
    case 'qdrant':        return new QdrantAdapter(config)
    case 'chroma':        return new ChromaAdapter(config)
    case 'pinecone':      return new PineconeAdapter(config)
    case 'pgvector':      return new PgvectorAdapter(config)
    case 'activespaces':  return new ActiveSpacesAdapter(config)
    default:
      throw new Error(`Database "${config.dbType}" is not yet supported.`)
  }
}

export type { DBAdapter, DBCollection, DBObject, DBProperty, DBHealthStatus, CreateCollectionInput, BatchResult } from './types'
