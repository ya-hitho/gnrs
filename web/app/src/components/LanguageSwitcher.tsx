import { useTranslation } from 'react-i18next'

import { SUPPORTED_LANGS, type Lang } from '@/lib/i18n'
import { cn } from '@/lib/cn'

const LABELS: Record<Lang, string> = { id: 'ID', en: 'EN' }

/**
 * Compact language toggle (ID / EN). Applies immediately and persists to
 * localStorage via i18next-browser-languagedetector. Rendered on the login
 * screen and in the sidebar / user menu so the language choice is always
 * reachable — not only buried in the profile dialog.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const current: Lang = (SUPPORTED_LANGS as readonly string[]).includes(i18n.resolvedLanguage ?? '')
    ? (i18n.resolvedLanguage as Lang)
    : 'id'

  return (
    <div
      role="group"
      aria-label={t('common.language')}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-slate-300 bg-white p-0.5',
        className,
      )}
    >
      {SUPPORTED_LANGS.map((lng) => (
        <button
          key={lng}
          type="button"
          aria-pressed={current === lng}
          onClick={() => void i18n.changeLanguage(lng)}
          className={cn(
            'rounded px-2 py-1 text-xs font-semibold transition',
            current === lng ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          {LABELS[lng]}
        </button>
      ))}
    </div>
  )
}
