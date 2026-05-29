import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2 } from 'lucide-react'

import { submitPublicAttendance } from '@/api/public'
import type { PublicAttendanceInput } from '@/api/public'
import { Button } from '@/components/Button'
import { PublicAttendanceForm } from '@/components/PublicAttendanceForm'

export function AbsenPage() {
  const [submitted, setSubmitted] = useState(false)
  const { t } = useTranslation()

  const mutation = useMutation({
    mutationFn: (input: PublicAttendanceInput) => submitPublicAttendance(input),
    onSuccess: (data) => {
      setSubmitted(true)
      // Same-tab navigation to wa.me hands off to WhatsApp (OS intent on
      // mobile, WhatsApp Web on desktop) with the report pre-filled.
      // window.open from an async onSuccess gets swallowed by popup blockers
      // — a same-tab navigation does not.
      if (data.waMeUrl) {
        window.location.href = data.waMeUrl
      }
    },
  })

  const waMeUrl = mutation.data?.waMeUrl ?? ''

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-6 sm:px-4 sm:py-12">
      <div className="mx-auto w-full max-w-xl rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold leading-tight text-slate-900 sm:text-2xl">
            {t('absen.heading')}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">{t('absen.note')}</p>
        </header>

        {submitted ? (
          <div className="space-y-5 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" aria-hidden />
            <h2 className="text-lg font-semibold text-slate-900">{t('absen.successHeading')}</h2>
            {waMeUrl ? (
              <>
                <p className="text-base text-slate-600 sm:text-sm">{t('absen.successWaHint')}</p>
                <a
                  href={waMeUrl}
                  className="inline-flex h-12 w-full items-center justify-center rounded-md bg-emerald-600 px-4 text-base font-medium text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:h-11 sm:text-sm"
                >
                  {t('absen.sendWa')}
                </a>
              </>
            ) : (
              <p className="text-base text-slate-600 sm:text-sm">{t('absen.savedToDb')}</p>
            )}
            <Button
              type="button"
              variant="secondary"
              className="h-12 w-full text-base sm:h-10 sm:w-auto sm:text-sm"
              onClick={() => {
                mutation.reset()
                setSubmitted(false)
              }}
            >
              {t('absen.sendAnother')}
            </Button>
          </div>
        ) : (
          <PublicAttendanceForm
            submitLabel={t('absen.submitBtn')}
            pending={mutation.isPending}
            error={mutation.error}
            onSubmit={(input) => mutation.mutate(input)}
          />
        )}

        <footer className="mt-8 flex items-center justify-start border-t border-slate-200 pt-5 text-sm text-slate-500 sm:pt-4">
          <a href="/" className="hover:underline">
            {t('absen.back')}
          </a>
        </footer>
      </div>
    </div>
  )
}
