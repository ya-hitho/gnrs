import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { createStudent } from '@/api/students'
import { PageShell } from '@/components/PageShell'
import { StudentForm } from '@/components/StudentForm'

export function NewStudentPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: createStudent,
    onSuccess: async (created) => {
      await qc.invalidateQueries({ queryKey: ['students'] })
      navigate(`/students/${created.id}`)
    },
  })

  return (
    <PageShell header={<h1 className="text-2xl font-semibold">Tambah Generus</h1>}>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <StudentForm
          submitLabel="Simpan"
          pending={mutation.isPending}
          error={mutation.error}
          onSubmit={(input) => mutation.mutate(input)}
          onCancel={() => navigate('/students')}
        />
      </div>
    </PageShell>
  )
}
