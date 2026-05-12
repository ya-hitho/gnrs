import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'

import {
  createTingkat,
  deleteTingkat,
  listTingkat,
  updateTingkat,
  type Tingkat,
  type TingkatInput,
} from '@/api/kurikulum'
import { ApiError } from '@/api/client'
import { Button } from '@/components/Button'
import { Field } from '@/components/Field'
import { Input } from '@/components/Input'
import { PageShell } from '@/components/PageShell'
import { useToast } from '@/lib/toast'

const schema = z.object({
  nama: z.string().min(1, 'Wajib diisi').max(100),
  urutan: z.coerce.number().int('Bilangan bulat').gte(0).lte(10000),
  umur: z
    .union([z.literal(''), z.coerce.number().int('Bilangan bulat').gte(0).lte(120)])
    .optional(),
})

type FormValues = z.input<typeof schema>

export function TingkatSection() {
  const toast = useToast()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Tingkat | null>(null)
  const [creating, setCreating] = useState(false)

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['tingkat'],
    queryFn: listTingkat,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tingkat'] })
    qc.invalidateQueries({ queryKey: ['materi-ajar'] })
  }

  const createMut = useMutation({
    mutationFn: (input: TingkatInput) => createTingkat(input),
    onSuccess: () => {
      toast('Tingkat ditambahkan', 'success')
      setCreating(false)
      invalidate()
    },
    onError: (err) => toast(apiMessage(err, 'Gagal menambah tingkat'), 'error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: TingkatInput }) => updateTingkat(id, input),
    onSuccess: () => {
      toast('Tingkat diperbarui', 'success')
      setEditing(null)
      invalidate()
    },
    onError: (err) => toast(apiMessage(err, 'Gagal memperbarui tingkat'), 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteTingkat,
    onSuccess: () => {
      toast('Tingkat dihapus', 'success')
      invalidate()
    },
    onError: (err) => toast(apiMessage(err, 'Gagal menghapus tingkat'), 'error'),
  })

  const handleDelete = (t: Tingkat) => {
    if (confirm(`Hapus tingkat "${t.nama}"? Tindakan ini tidak dapat dibatalkan.`)) {
      deleteMut.mutate(t.id)
    }
  }

  const header = (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-semibold">Tingkat</h2>
        <p className="text-sm text-slate-500">
          Kelola jenjang materi ajar berbasis umur. Kolom umur kosong = tidak dipatok ke usia tertentu.
        </p>
      </div>
      {!creating ? (
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={16} className="mr-1" /> Tambah Tingkat
        </Button>
      ) : null}
    </div>
  )

  return (
    <PageShell header={header}>
      <div className="space-y-4">

      {creating ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Tingkat baru</h3>
          <TingkatForm
            pending={createMut.isPending}
            error={createMut.error}
            onSubmit={(input) => createMut.mutate(input)}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Nama</th>
              <th className="px-4 py-2 w-20">Umur</th>
              <th className="px-4 py-2 w-24">Urutan</th>
              <th className="px-4 py-2 w-24 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  Memuat…
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  Belum ada tingkat.
                </td>
              </tr>
            ) : (
              list.map((t) =>
                editing?.id === t.id ? (
                  <tr key={t.id} className="bg-slate-50">
                    <td colSpan={4} className="px-4 py-3">
                      <TingkatForm
                        initial={t}
                        pending={updateMut.isPending}
                        error={updateMut.error}
                        onSubmit={(input) => updateMut.mutate({ id: t.id, input })}
                        onCancel={() => setEditing(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={t.id}>
                    <td className="px-4 py-2 font-medium text-slate-900">{t.nama}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {t.umur != null ? `${t.umur} thn` : '—'}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{t.urutan}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing(t)}
                          className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                          aria-label="Ubah"
                          title="Ubah"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(t)}
                          disabled={deleteMut.isPending}
                          className="rounded-md p-1.5 text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label="Hapus"
                          title="Hapus"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>
      </div>
    </PageShell>
  )
}

function TingkatForm({
  initial,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Tingkat
  pending?: boolean
  error?: unknown
  onSubmit: (input: TingkatInput) => void
  onCancel: () => void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nama: initial?.nama ?? '',
      urutan: initial?.urutan ?? 0,
      umur: initial?.umur ?? '',
    },
  })

  const apiError = error instanceof ApiError ? error.message : null

  return (
    <form
      onSubmit={handleSubmit((v) =>
        onSubmit({
          nama: v.nama,
          urutan: Number(v.urutan),
          umur: v.umur === '' || v.umur === undefined ? null : Number(v.umur),
        }),
      )}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_120px_120px]">
        <Field label="Nama" htmlFor="nama" error={errors.nama?.message}>
          <Input id="nama" {...register('nama')} />
        </Field>
        <Field label="Umur (tahun)" htmlFor="umur" error={errors.umur?.message}>
          <Input id="umur" type="number" min={0} max={120} placeholder="kosong = tanpa umur" {...register('umur')} />
        </Field>
        <Field label="Urutan" htmlFor="urutan" error={errors.urutan?.message}>
          <Input id="urutan" type="number" min={0} {...register('urutan')} />
        </Field>
      </div>
      {apiError ? <p className="text-sm text-red-600">{apiError}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Menyimpan…' : initial ? 'Simpan' : 'Tambah'}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </form>
  )
}

function apiMessage(err: unknown, fallback: string) {
  if (err instanceof ApiError) return err.message || fallback
  return fallback
}
