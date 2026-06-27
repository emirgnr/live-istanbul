import type { Line } from '@/lib/network/types'

export function LineBadge({
  line,
  size = 'md',
}: {
  line: Pick<Line, 'code' | 'color' | 'onColor'>
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <span
      className={`line-badge line-badge--${size}`}
      style={{ background: line.color, color: line.onColor }}
    >
      {line.code}
    </span>
  )
}
