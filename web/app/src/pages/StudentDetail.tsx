import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { deleteStudent, getStudent, updateStudent } from '@/api/students'
import { useAuth } from '@/lib/auth'
import { ageInYears } from '@/lib/age'
import { Button } from '@/components/Button'
import { PageShell } from '@/components/PageShell'
import { StudentForm } from '@/components/StudentForm'

export function StudentDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const editFlag = params.get('edit') === '1'
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(isAdmin && editFlag)

  const studentQuery = useQuery({
    queryKey: ['students', id],
    queryFn: () => getStudent(id),
    enabled: !!id,
  })

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateStudent>[1]) => updateStudent(id, input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['students'] })
      setEditing(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteStudent(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['students'] })
      navigate('/students')
    },
  })

  if (studentQuery.isPending)
    return (
      <PageShell>
        <p className="text-slate-500">Memuat…</p>
      </PageShell>
    )
  if (studentQuery.isError || !studentQuery.data)
    return (
      <PageShell>
        <p className="text-red-600">Gagal memuat data.</p>
      </PageShell>
    )

  const s = studentQuery.data
  const statusLabel = s.status === 'active' ? 'Aktif' : 'Keluar'

  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-2xl font-semibold break-words">{s.name}</h1>
      {isAdmin && !editing ? (
        <div className="flex gap-2 self-start sm:self-auto">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Ubah
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm(`Hapus ${s.name}? Tindakan ini tidak dapat dibatalkan.`)) {
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
          <StudentForm
            initial={s}
            submitLabel="Simpan"
            pending={updateMutation.isPending}
            error={updateMutation.error}
            onSubmit={(input) => updateMutation.mutate(input)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <Row label="Nama" value={s.name} />
            <Row label="Nama Panggilan" value={s.nickname ?? '—'} />
            <Row
              label="Tanggal Lahir"
              value={
                s.dateOfBirth
                  ? `${s.dateOfBirth.slice(0, 10)}${
                      ageInYears(s.dateOfBirth) !== null ? ` (${ageInYears(s.dateOfBirth)} tahun)` : ''
                    }`
                  : '—'
              }
            />
            <Row label="Jenis Kelamin" value={s.gender === 'male' ? 'Laki-laki' : 'Perempuan'} />
            <Row label="Jenjang" value={s.level ?? '—'} />
            <Row label="Kelompok" value={s.kelompok ?? '—'} className="sm:col-span-2" />
            <Row label="Tanggal Masuk" value={s.joinedAt?.slice(0, 10) ?? '—'} />
            <Row label="Status" value={statusLabel} />
            <Row label="Tanggal Keluar" value={s.leftAt?.slice(0, 10) ?? '—'} />
            <Row label="Keterangan Keluar" value={s.leaveReason ?? '—'} />
            <Row label="Sebutan Orang Tua" value={s.parentTitle ?? '—'} />
            <Row label="Nama Orang Tua" value={s.parentName ?? '—'} />
            <Row
              label="WhatsApp Orang Tua"
              value={
                s.parentPhone
                  ? `+${({ ID: '62', SG: '65', US: '1', CA: '1' } as any)[s.parentPhoneRegion ?? 'ID'] ?? '62'}${s.parentPhone.replace(/^0+/, '')}`
                  : '—'
              }
            />
            <Row label="Email Orang Tua" value={s.parentEmail ?? '—'} className="sm:col-span-2" />
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
      <dd className="mt-1 break-words text-slate-900">{value}</dd>
    </div>
  )
}
