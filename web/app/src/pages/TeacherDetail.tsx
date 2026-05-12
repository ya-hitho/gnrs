import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { deleteTeacher, getTeacher, updateTeacher } from '@/api/teachers'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/Button'
import { PageShell } from '@/components/PageShell'
import { TeacherForm } from '@/components/TeacherForm'

export function TeacherDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const editFlag = params.get('edit') === '1'
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(isAdmin && editFlag)

  const teacherQuery = useQuery({
    queryKey: ['teachers', id],
    queryFn: () => getTeacher(id),
    enabled: !!id,
  })

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateTeacher>[1]) => updateTeacher(id, input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['teachers'] })
      setEditing(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteTeacher(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['teachers'] })
      navigate('/teachers')
    },
  })

  if (teacherQuery.isPending)
    return (
      <PageShell>
        <p className="text-slate-500">Memuat…</p>
      </PageShell>
    )
  if (teacherQuery.isError || !teacherQuery.data)
    return (
      <PageShell>
        <p className="text-red-600">Gagal memuat data.</p>
      </PageShell>
    )

  const t = teacherQuery.data
  const statusLabel = t.status === 'active' ? 'Aktif' : 'Purna'

  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-2xl font-semibold break-words">{t.name}</h1>
      {isAdmin && !editing ? (
        <div className="flex gap-2 self-start sm:self-auto">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Ubah
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm(`Hapus ${t.name}? Tindakan ini tidak dapat dibatalkan.`)) {
                deleteMutation.mutate()
              }
            }}
            disabled={deleteMutation.isPending}
          >
            Hapus
          </Button>
        </div>
      ) : null}
    </div>
  )

  return (
    <PageShell header={header}>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {editing ? (
          <TeacherForm
            initial={t}
            submitLabel="Simpan"
            pending={updateMutation.isPending}
            error={updateMutation.error}
            onSubmit={(input) => updateMutation.mutate(input)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2 text-sm">
            <Row label="Nama Pengajar" value={t.name} />
            <Row label="Nama Panggilan" value={t.nickname ?? '—'} />
            <Row label="Kelompok" value={t.kelompok} />
            <Row label="Desa" value={t.desa} />
            <Row label="Daerah" value={t.daerah} className="sm:col-span-2" />
            <Row label="Tanggal Masuk" value={t.joinedAt?.slice(0, 10) ?? '—'} />
            <Row label="Tanggal Purna" value={t.retiredAt?.slice(0, 10) ?? '—'} />
            <Row label="Status" value={statusLabel} />
            <Row label="Keterangan" value={t.notes ?? '—'} className="sm:col-span-2" />
          </dl>
        )}
      </div>
    </PageShell>
  )
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-900 break-words">{value}</dd>
    </div>
  )
}
