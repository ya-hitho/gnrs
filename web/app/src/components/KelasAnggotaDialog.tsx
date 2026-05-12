import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, UserPlus } from 'lucide-react'

import { addAnggota, listAnggota, removeAnggota } from '@/api/kelas'
import { listStudents } from '@/api/students'
import { ApiError } from '@/api/client'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { Input } from '@/components/Input'
import { useToast } from '@/lib/toast'

/**
 * KelasAnggotaDialog — manage the murid roster of a kelas. Lists current
 * members (with remove); below, lets the admin search active students and
 * tick them to add. Bulk-add uses the existing /api/kelas/{id}/anggota POST.
 */
export function KelasAnggotaDialog({
  kelasId,
  kelasNama,
  tingkat,
  onClose,
}: {
  kelasId: string
  kelasNama: string
  tingkat: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const { data: anggota = [], isPending } = useQuery({
    queryKey: ['kelas-anggota', kelasId],
    queryFn: () => listAnggota(kelasId),
  })

  // Pull active students for the picker. We over-fetch a bit (limit 200) so
  // typical kelas-sizing flows don't need pagination inside the dialog.
  const { data: studentsRes } = useQuery({
    queryKey: ['students-pick', { q: search }],
    queryFn: () => listStudents({ q: search, status: 'active', limit: 200, offset: 0 }),
  })

  const anggotaIds = useMemo(
    () => new Set(anggota.map((a) => a.muridUserId)),
    [anggota],
  )

  const availableStudents = useMemo(() => {
    const items = studentsRes?.items ?? []
    return items.filter((s) => !anggotaIds.has(s.id))
  }, [studentsRes, anggotaIds])

  const addMut = useMutation({
    mutationFn: (ids: string[]) => addAnggota(kelasId, ids),
    onSuccess: () => {
      toast('Anggota ditambahkan', 'success')
      qc.invalidateQueries({ queryKey: ['kelas-anggota', kelasId] })
      setPicked(new Set())
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Gagal menambah anggota', 'error'),
  })

  const removeMut = useMutation({
    mutationFn: (muridId: string) => removeAnggota(kelasId, muridId),
    onSuccess: () => {
      toast('Anggota dihapus', 'success')
      qc.invalidateQueries({ queryKey: ['kelas-anggota', kelasId] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Gagal menghapus anggota', 'error'),
  })

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <Dialog title={`Anggota Kelas — ${kelasNama}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        {/* Current members */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Anggota saat ini ({anggota.length})
          </h4>
          {isPending ? (
            <p className="text-sm text-slate-500">Memuat…</p>
          ) : anggota.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
              Belum ada anggota di kelas ini.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {anggota.map((a) => (
                <li key={a.muridUserId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="truncate text-sm">{a.muridName}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Hapus ${a.muridName} dari kelas?`)) {
                        removeMut.mutate(a.muridUserId)
                      }
                    }}
                    disabled={removeMut.isPending}
                    className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Hapus anggota"
                    title="Hapus dari kelas"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Add new */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Tambah anggota
          </h4>
          <Input
            placeholder={`Cari generus untuk tingkat ${tingkat}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-2"
          />
          <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
            {availableStudents.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-slate-500">
                {search ? 'Tidak ada generus yang cocok.' : 'Semua generus aktif sudah jadi anggota.'}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {availableStudents.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 transition hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={picked.has(s.id)}
                        onChange={() => toggle(s.id)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{s.name}</div>
                        <div className="truncate text-xs text-slate-500">
                          {s.nickname ? `${s.nickname} · ` : ''}
                          {s.level ?? '—'}
                          {s.kelompok ? ` · ${s.kelompok}` : ''}
                        </div>
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-4">
          <span className="text-xs text-slate-500">{picked.size} dipilih</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Tutup
            </Button>
            <Button
              onClick={() => addMut.mutate(Array.from(picked))}
              disabled={addMut.isPending || picked.size === 0}
            >
              <UserPlus size={16} className="mr-1" />
              {addMut.isPending ? 'Menambah…' : `Tambah ${picked.size > 0 ? `(${picked.size})` : ''}`}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
