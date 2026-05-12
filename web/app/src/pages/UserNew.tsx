import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { createUser, ROLE_LABEL, USER_ROLES, type UserRole } from '@/api/users'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Field } from '@/components/Field'
import { PageShell } from '@/components/PageShell'

const schema = z.object({
  email: z.string().email('Email tidak valid'),
  username: z.string().optional().or(z.literal('')),
  name: z.string().min(1, 'Nama wajib diisi').max(200),
  password: z.string().min(6, 'Minimal 6 karakter').max(200),
  role: z.enum(USER_ROLES),
})

type FormValues = z.infer<typeof schema>

export function UserNewPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'staff' as UserRole },
  })

  const mutation = useMutation({
    mutationFn: createUser,
    onSuccess: async (created) => {
      await qc.invalidateQueries({ queryKey: ['users'] })
      navigate(`/pengaturan/pengguna/${created.id}`)
    },
  })

  const apiError = mutation.error instanceof ApiError ? mutation.error.message : null

  const onSubmit = (v: FormValues) => {
    mutation.mutate({
      email: v.email.trim(),
      username: v.username?.trim() || undefined,
      name: v.name.trim(),
      password: v.password,
      role: v.role,
    })
  }

  return (
    <PageShell header={<h1 className="text-2xl font-semibold">Tambah Pengguna</h1>}>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nama lengkap" htmlFor="name" error={errors.name?.message}>
              <Input id="name" type="text" autoComplete="name" autoFocus {...register('name')} />
            </Field>
            <Field label="Email" htmlFor="email" error={errors.email?.message}>
              <Input id="email" type="email" autoComplete="email" {...register('email')} />
            </Field>
            <Field
              label="Nama pengguna (opsional)"
              htmlFor="username"
              error={errors.username?.message}
            >
              <Input
                id="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="login tanpa email"
                {...register('username')}
              />
            </Field>
            <Field label="Role" htmlFor="role" error={errors.role?.message}>
              <select
                id="role"
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                {...register('role')}
              >
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Kata sandi awal"
              htmlFor="password"
              error={errors.password?.message}
              className="sm:col-span-2"
            >
              <Input
                id="password"
                type="text"
                autoComplete="new-password"
                placeholder="Minimal 6 karakter"
                {...register('password')}
              />
            </Field>
          </div>
          {apiError ? <p className="text-sm text-red-600">{apiError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate('/pengaturan/pengguna')}>
              Batal
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </div>
        </form>
      </div>
    </PageShell>
  )
}
