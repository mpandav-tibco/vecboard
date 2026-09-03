import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useConnectionStore } from '@/store/connectionStore'
import { getAdapter } from '@/lib/adapters'
import toast from 'react-hot-toast'

export function useObjects(className: string, limit = 25, offset = 0) {
  const config = useConnectionStore((s) => s.config)
  return useQuery({
    queryKey: ['objects', className, limit, offset, config?.host, config?.port, config?.dbType],
    queryFn: () => getAdapter(config!).listObjects(className, limit, offset),
    enabled: !!config && !!className,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}

export function useCreateObject() {
  const config = useConnectionStore((s) => s.config)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ className, properties, vector }: { className: string; properties: Record<string, unknown>; vector?: number[] }) =>
      getAdapter(config!).createObject(className, properties, vector),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['objects', vars.className] })
      qc.invalidateQueries({ queryKey: ['objectCount', vars.className] })
      toast.success('Object created')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteObject() {
  const config = useConnectionStore((s) => s.config)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ className, id }: { className: string; id: string }) =>
      getAdapter(config!).deleteObject(className, id),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['objects', vars.className] })
      qc.invalidateQueries({ queryKey: ['objectCount', vars.className] })
      toast.success('Object deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useBatchUpsert() {
  const config = useConnectionStore((s) => s.config)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      className,
      objects,
    }: {
      className: string
      objects: Array<{ id?: string; properties: Record<string, unknown>; vector?: number[] }>
    }) => getAdapter(config!).batchInsert(className, objects),
    onSuccess: (result, vars) => {
      qc.invalidateQueries({ queryKey: ['objects', vars.className] })
      qc.invalidateQueries({ queryKey: ['objectCount', vars.className] })
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} errors during batch import`)
      } else {
        toast.success(`${result.success} objects imported`)
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
