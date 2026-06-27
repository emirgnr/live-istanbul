import { useEffect, useState } from 'react'
import { useUiStore } from '@/lib/stores/useUiStore'
import { resolveTheme } from '@/lib/theme'

/** The concrete 'light' | 'dark' currently in effect (resolves 'system' live). */
export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useUiStore((s) => s.theme)
  const [resolved, setResolved] = useState(() => resolveTheme(theme))

  useEffect(() => {
    setResolved(resolveTheme(theme))
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolved(resolveTheme('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  return resolved
}
