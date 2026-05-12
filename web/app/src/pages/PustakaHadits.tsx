import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BookOpenText } from 'lucide-react'

import { listKitab, type HaditsKitab } from '@/api/hadits'
import { LibraryShell } from '@/components/LibraryShell'

/**
 * PustakaHadits — Hadits Himpunan landing. Maktabah Syamilah is hidden by
 * project policy; its kitab rows remain in the DB only as metadata base for
 * cross-references inside hadits/doa.
 */
export function PustakaHaditsPage() {
  const { data: list = [], isPending, isError } = useQuery({
    queryKey: ['hadits-kitab-all'],
    queryFn: () => listKitab(),
    staleTime: 5 * 60 * 1000,
  })
  const himpunan = list.filter((k) => k.scope === 'hadits')

  return (
    <LibraryShell
      backTo="/pustaka"
      backLabel="Pustaka"
      bgClassName="bg-slate-50"
      contentClassName="px-4 pt-14 pb-6 md:px-8"
    >
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold">Hadits Himpunan</h1>
        <p className="mb-4 mt-1 text-sm text-slate-500">
          Daftar judul kitab himpunan hadits PPG. Konten hadits disembunyikan; hanya metadata
          yang ditampilkan.
        </p>

        {isError ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Gagal memuat daftar kitab.
          </p>
        ) : null}
        {isPending ? <p className="text-sm text-slate-500">Memuat kitab…</p> : null}

        <div className="grid gap-2 sm:grid-cols-2">
          {himpunan.map((k) => (
            <KitabCard key={k.id} kitab={k} />
          ))}
        </div>
      </div>
    </LibraryShell>
  )
}

function KitabCard({ kitab: k }: { kitab: HaditsKitab }) {
  return (
    <Link
      to={`/pustaka/kitab/${encodeURIComponent(k.slug)}`}
      className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
        <BookOpenText size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-slate-900">{k.nama}</div>
        <div className="truncate text-xs text-slate-500">
          {k.babCount} bab · {k.haditsCount} hadits
          {k.perawi ? ` · ${k.perawi}` : ''}
        </div>
      </div>
      {k.namaArab ? (
        <div lang="ar" dir="rtl" className="font-arab text-right text-base text-slate-600">
          {k.namaArab}
        </div>
      ) : null}
    </Link>
  )
}
