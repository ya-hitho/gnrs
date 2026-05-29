import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SortColumn, SortDir } from '@/api/types'

interface SortableThProps {
  column: SortColumn
  label: string
  activeColumn?: SortColumn
  activeDir?: SortDir
  onSort: (column: SortColumn, dir: SortDir) => void
  className?: string
}

export function SortableTh({
  column,
  label,
  activeColumn,
  activeDir,
  onSort,
  className,
}: SortableThProps) {
  const { t } = useTranslation()
  const isActive = activeColumn === column
  // Inactive column: first click sorts ascending. Active column: toggle.
  const nextDir: SortDir = isActive && activeDir === 'asc' ? 'desc' : 'asc'
  const ariaLabel = isActive
    ? activeDir === 'asc'
      ? t('common.sortDesc')
      : t('common.sortAsc')
    : t('common.sortBy', { col: label })

  return (
    <th className={'px-4 py-2 ' + (className ?? '')}>
      <button
        type="button"
        onClick={() => onSort(column, nextDir)}
        aria-label={ariaLabel}
        title={ariaLabel}
        className="inline-flex items-center gap-1 font-inherit uppercase tracking-wide text-slate-500 hover:text-slate-800"
      >
        <span>{label}</span>
        {isActive ? (
          activeDir === 'asc' ? (
            <ArrowUp size={12} className="text-slate-700" />
          ) : (
            <ArrowDown size={12} className="text-slate-700" />
          )
        ) : (
          <ArrowUpDown size={12} className="text-slate-300" />
        )}
      </button>
    </th>
  )
}
