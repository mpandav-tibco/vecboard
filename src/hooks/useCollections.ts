import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useConnectionStore } from '@/store/connectionStore'
import { getAdapter } from '@/lib/adapters'
import type { CreateCollectionInput } from '@/lib/adapters'
import toast from 'react-hot-toast'

export function useCollections() {
  const config = useConnectionStore((s) => s.config)
  return useQuery({
    queryKey: ['collections', config?.host, config?.port, config?.dbType],
    queryFn: () => getAdapter(config!).listCollections(),
    enabled: !!config,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useCollection(name: string) {
  const config = useConnectionStore((s) => s.config)
  return useQuery({
    queryKey: ['collection', name, config?.host, config?.port, config?.dbType],
    queryFn: () => getAdapter(config!).getCollection(name),
    enabled: !!config && !!name,
  })
}

export function useObjectCount(className: string) {
  const config = useConnectionStore((s) => s.config)
  return useQuery({
    queryKey: ['objectCount', className, config?.host, config?.port, config?.dbType],
    queryFn: () => getAdapter(config!).getObjectCount(className),
    enabled: !!config && !!className,
    staleTime: 10_000,
  })
}

export function useCreateCollection() {
  const config = useConnectionStore((s) => s.config)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCollectionInput) => getAdapter(config!).createCollection(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] })
      toast.success('Collection created')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteCollection() {
  const config = useConnectionStore((s) => s.config)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => getAdapter(config!).deleteCollection(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] })
      toast.success('Collection deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
