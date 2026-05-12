import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Clock } from 'lucide-react'

import { createSesi, updateSesi, type Sesi, type SesiInput } from '@/api/sesi'
import { listKelas } from '@/api/kelas'
import { ApiError } from '@/api/client'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { Field } from '@/components/Field'
import { Input } from '@/components/Input'
import { TimeDialPopup } from '@/components/TimeDialPopup'
import {
  MateriSourcePicker,
  emptyMateriSourceValue,
  type MateriSourceValue,
} from '@/components/MateriSourcePicker'
import { useToast } from '@/lib/toast'

/**
 * SesiFormDialog — shared create/edit dialog for sesi. Used from both the
 * Kelas list (`+ Tambah sesi` inside an open kelas card) and the calendar
 * view. The materi picker is multi-source: kurikulum drilldown OR a fixed
 * library (Quran / Hadits / Tilawati / Doa) with an aspect (reciting /
 * memorizing / review / manqul).
 */

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n)
}
function localDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const schema = z.object({
  tanggal: z.string().length(10, 'Format tanggal YYYY-MM-DD'),
  topik: z.string().min(1, 'Wajib diisi').max(500),
})
type FormValues = z.infer<typeof schema>

export type SesiFormDefaults = {
  /** Pre-bound kelasId — when set, the sesi is created scoped to the kelas. */
  kelasId?: string
  /** Default tingkat for the materi picker (typically the kelas's tingkat). */
  defaultTingkat?: string
  /** Default date when creating. */
  defaultDate?: string
}

export function SesiFormDialog({
  mode,
  sesi,
  defaults,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  sesi?: Sesi
  defaults?: SesiFormDefaults
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const qc = useQueryClient()

  // Kelas picker — bound to a kelasId. Defaults from props (typically the
  // calendar's "Pilih kelas" filter); user can change in the form.
  const [kelasId, setKelasId] = useState<string>(sesi?.kelasId ?? defaults?.kelasId ?? '')
  const { data: kelasList = [] } = useQuery({
    queryKey: ['kelas'],
    queryFn: () => listKelas({}),
    staleTime: 60_000,
  })
  const pickedKelas = useMemo(
    () => kelasList.find((k) => k.id === kelasId) ?? null,
    [kelasList, kelasId],
  )
  // Tingkat auto-follows the picked kelas (or the legacy defaults prop).
  const autoTingkat = pickedKelas?.tingkat ?? sesi?.tingkat ?? defaults?.defaultTingkat ?? ''

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      tanggal: sesi?.tanggal?.slice(0, 10) ?? defaults?.defaultDate ?? localDate(new Date()),
      topik: sesi?.topik ?? '',
    },
  })

  // Times — controlled outside RHF (TimeDialPopup writes back live).
  const [mulai, setMulai] = useState(sesi?.mulai ?? '')
  const [selesai, setSelesai] = useState(sesi?.selesai ?? '')
  const [dialOpenFor, setDialOpenFor] = useState<'start' | 'end' | null>(null)

  // Materi picker — preserves drilldown state across aspect/source switches.
  const [source, setSource] = useState<MateriSourceValue>(() => {
    if (sesi) {
      const base = emptyMateriSourceValue(sesi.tingkat ?? defaults?.defaultTingkat)
      // Best-effort rehydration from the saved row. Kurikulum drilldown can't
      // be reconstructed from materiAjarId alone without a fetch — we just
      // pin materiAjarId and let the user re-pick if they want to change.
      if (sesi.libraryKind) {
        base.libraryKind = sesi.libraryKind
        base.libraryAspect = sesi.libraryAspect ?? null
        base.libraryRef = sesi.libraryRef ?? null
      } else if (sesi.materiAjarIds && sesi.materiAjarIds.length > 0) {
        base.libraryKind = 'kurikulum'
        base.materiAjarIds = sesi.materiAjarIds
      } else if (sesi.materiAjarId) {
        base.libraryKind = 'kurikulum'
        base.materiAjarIds = [sesi.materiAjarId]
      }
      return base
    }
    return emptyMateriSourceValue(defaults?.defaultTingkat)
  })

  // Invalidate rencana caches too — the backend auto-syncs sesi materi
  // into the kelas's monthly rencana_bulanan, so the Rencana Ajar tab
  // should reflect newly-attached materi without a manual refresh.
  const invalidateSesi = () => {
    qc.invalidateQueries({ queryKey: ['sesi'] })
    qc.invalidateQueries({ queryKey: ['kelas-sesi'] })
    qc.invalidateQueries({ queryKey: ['rencana'] })
    qc.invalidateQueries({ queryKey: ['rencana-full'] })
  }

  const createMut = useMutation({
    mutationFn: (input: SesiInput) => createSesi(input),
    onSuccess: () => {
      toast('Sesi ditambahkan', 'success')
      invalidateSesi()
      onSaved()
    },
    onError: (e) => toast(apiMsg(e, 'Gagal menambah sesi'), 'error'),
  })

  const updateMut = useMutation({
    mutationFn: (input: SesiInput) => updateSesi(sesi!.id, input),
    onSuccess: () => {
      toast('Sesi diperbarui', 'success')
      invalidateSesi()
      onSaved()
    },
    onError: (e) => toast(apiMsg(e, 'Gagal memperbarui sesi'), 'error'),
  })

  const pending = createMut.isPending || updateMut.isPending

  // Suggest a friendly default topic from the source selection when topik
  // is empty — saves typing for the common case.
  const defaultTopik = useMemo(() => suggestTopik(source), [source])

  const onSubmit = (v: FormValues) => {
    const topik = v.topik.trim() || defaultTopik || 'Sesi'
    const isKurikulum = source.libraryKind === 'kurikulum'
    const input: SesiInput = {
      tanggal: v.tanggal,
      mulai: mulai || null,
      selesai: selesai || null,
      topik,
      catatan: null,
      tingkat: autoTingkat || null,
      materiAjarId: isKurikulum ? source.materiAjarIds[0] ?? null : null,
      materiAjarIds: isKurikulum ? source.materiAjarIds : [],
      kelasId: kelasId || null,
      libraryKind: source.libraryKind,
      libraryAspect: source.libraryAspect,
      libraryRef: isKurikulum ? null : source.libraryRef,
    }
    if (mode === 'create') createMut.mutate(input)
    else updateMut.mutate(input)
  }

  return (
    <Dialog
      title={mode === 'create' ? 'Tambah Sesi' : 'Ubah Sesi'}
      onClose={onClose}
      size="lg"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field
          label="Kelas"
          htmlFor="sesi-kelas"
          hint={
            pickedKelas
              ? `Tingkat: ${pickedKelas.tingkat}`
              : 'Pilih kelas untuk menyimpan sesi.'
          }
        >
          <select
            id="sesi-kelas"
            value={kelasId}
            onChange={(e) => setKelasId(e.target.value)}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <option value="">— pilih kelas —</option>
            {kelasList.map((k) => (
              <option key={k.id} value={k.id}>
                {k.nama} · {k.tingkat}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tanggal" htmlFor="sesi-tanggal" error={errors.tanggal?.message}>
            <Input id="sesi-tanggal" type="date" {...register('tanggal')} />
          </Field>
          <Field
            label="Topik"
            htmlFor="sesi-topik"
            error={errors.topik?.message}
            hint={
              autoTingkat
                ? `Tingkat: ${autoTingkat} (mengikuti kelas)`
                : defaultTopik && !errors.topik
                ? `Otomatis: ${defaultTopik}`
                : undefined
            }
          >
            <Input
              id="sesi-topik"
              placeholder={defaultTopik || "Mis. Bacaan Al-Fatihah"}
              {...register('topik')}
            />
          </Field>
        </div>

        {/* Simple time inputs + dial popup. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mulai (HH:MM)" htmlFor="sesi-mulai">
            <div className="flex items-center gap-1">
              <Input
                id="sesi-mulai"
                type="time"
                value={mulai}
                onChange={(e) => setMulai(e.target.value)}
                disabled={pending}
              />
              <button
                type="button"
                onClick={() => setDialOpenFor('start')}
                disabled={pending}
                className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                aria-label="Buka dial clock untuk mulai"
                title="Pilih dengan dial clock"
              >
                <Clock size={14} />
              </button>
            </div>
          </Field>
          <Field label="Selesai (HH:MM)" htmlFor="sesi-selesai">
            <div className="flex items-center gap-1">
              <Input
                id="sesi-selesai"
                type="time"
                value={selesai}
                onChange={(e) => setSelesai(e.target.value)}
                disabled={pending}
              />
              <button
                type="button"
                onClick={() => setDialOpenFor('end')}
                disabled={pending}
                className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                aria-label="Buka dial clock untuk selesai"
                title="Pilih dengan dial clock"
              >
                <Clock size={14} />
              </button>
            </div>
          </Field>
        </div>

        {dialOpenFor ? (
          <TimeDialPopup
            start={mulai}
            end={selesai}
            onStartChange={setMulai}
            onEndChange={setSelesai}
            initialSlot={dialOpenFor}
            onClose={() => setDialOpenFor(null)}
          />
        ) : null}

        <MateriSourcePicker value={source} onChange={setSource} fixedTingkat={autoTingkat} />

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Batal
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function suggestTopik(s: MateriSourceValue): string {
  switch (s.libraryKind) {
    case 'kurikulum':
      return ''
    case 'quran':
      return s.libraryRef ? `Al-Qur'an ${s.libraryRef}` : "Al-Qur'an"
    case 'hadits':
      return s.libraryRef ? `Hadits ${s.libraryRef}` : 'Hadits'
    case 'tilawati':
      return s.libraryRef ? `Tilawati ${s.libraryRef}` : 'Tilawati'
    case 'doa':
      return s.libraryRef ? `Doa #${s.libraryRef}` : 'Doa'
    default:
      return ''
  }
}

function apiMsg(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message || fallback
  return fallback
}
