import { SchemeMap } from './SchemeMap'

/**
 * "Şema" mode — the relational metro diagram. It is now just the headless {@link SchemeMap};
 * selection/route live in useAppStore and the shared left-sidebar Panel (rendered by App) is the
 * one info surface for BOTH map modes.
 */
export function SchemeView() {
  return <SchemeMap />
}
