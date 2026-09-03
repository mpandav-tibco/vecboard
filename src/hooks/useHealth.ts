import { useQuery } from '@tanstack/react-query'
import { useConnectionStore } from '@/store/connectionStore'
import { getAdapter } from '@/lib/adapters'
import { useEffect } from 'react'

export function useHealth() {
  const config = useConnectionStore((s) => s.config)
  const setStatus = useConnectionStore((s) => s.setStatus)

  const query = useQuery({
    queryKey: ['health', config?.host, config?.port, config?.scheme, config?.dbType],
    queryFn: () => getAdapter(config!).checkHealth(),
    enabled: !!config,
    refetchInterval: 15_000,
    retry: 1,
  })

  useEffect(() => {
    if (query.data) {
      if (query.data.ready) {
        setStatus('connected', undefined, query.data.version)
      } else {
        setStatus('error', query.data.error)
      }
    }
    if (query.isError) {
      setStatus('error', query.error instanceof Error ? query.error.message : 'Connection failed')
    }
  }, [query.data, query.isError])

  return query
}
