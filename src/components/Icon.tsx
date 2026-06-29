type IconName =
  | 'search'
  | 'chevron-right'
  | 'arrow-left'
  | 'star'
  | 'star-filled'
  | 'x'
  | 'elevator'
  | 'escalator'
  | 'wc'
  | 'accessible'
  | 'train'
  | 'clock'
  | 'pin'
  | 'transfer'
  | 'baby'
  | 'mosque'
  | 'crosshair'
  | 'moon'
  | 'calendar'
  | 'walk'

const PATHS: Record<IconName, { d: string; fill?: boolean }[]> = {
  search: [{ d: 'M21 21l-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z' }],
  'chevron-right': [{ d: 'M9 18l6-6-6-6' }],
  'arrow-left': [{ d: 'M19 12H5M12 19l-7-7 7-7' }],
  star: [{ d: 'M12 17.3l-6.2 3.7 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.8 1.6 7z' }],
  'star-filled': [
    { d: 'M12 17.3l-6.2 3.7 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.8 1.6 7z', fill: true },
  ],
  x: [{ d: 'M18 6 6 18M6 6l12 12' }],
  elevator: [
    { d: 'M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z' },
    { d: 'M10 9l2-2 2 2M10 15l2 2 2-2' },
  ],
  escalator: [{ d: 'M5 18 19 6M7 18H5M19 6h-2' }, { d: 'M9 18l8-8' }],
  wc: [{ d: 'M8 4v16M16 4v16M5 8h6M13 8c1.5 0 3 1 3 4' }],
  accessible: [
    { d: 'M12 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z', fill: true },
    { d: 'M9 9h6l-1 5M7 21a4 4 0 0 1 4-6M14 14l3 5' },
  ],
  train: [
    { d: 'M8 3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z' },
    { d: 'M5 11h14M9 17l-2 4M15 17l2 4M9 7h6' },
  ],
  clock: [{ d: 'M12 7v5l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z' }],
  pin: [{ d: 'M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z' }, { d: 'M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z' }],
  transfer: [{ d: 'M7 4 4 7l3 3M4 7h12M17 20l3-3-3-3M20 17H8' }],
  baby: [{ d: 'M9 12a3 3 0 0 0 6 0M9 8h.01M15 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z' }],
  mosque: [{ d: 'M5 21v-7a7 7 0 0 1 14 0v7M3 21h18M9 21v-3a3 3 0 0 1 6 0v3M12 3v2' }],
  crosshair: [
    { d: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z' },
    { d: 'M12 2v3M12 19v3M2 12h3M19 12h3' },
    { d: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z', fill: true },
  ],
  moon: [{ d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z' }],
  calendar: [
    { d: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z' },
    { d: 'M7 3v3M17 3v3M4 9.5h16' },
  ],
  walk: [
    { d: 'M13.5 4.2a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z', fill: true },
    { d: 'M11 6.5 8.5 9 6 8M11 6.5l2.2 1 1.4 3 2.4 1.2M13.2 10l-2.7 1 .8 4M10.5 16l-2.5 5M11.3 15l2.2 6' },
  ],
}

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName
  size?: number
  className?: string
}) {
  const paths = PATHS[name]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill ? 'currentColor' : 'none'} stroke={p.fill ? 'none' : 'currentColor'} />
      ))}
    </svg>
  )
}

export type { IconName }
