import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { useAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Field } from '@/components/Field'
import { useState } from 'react'

const schema = z.object({
  identifier: z.string().min(1, 'Email atau nama pengguna wajib diisi'),
  password: z.string().min(1, 'Kata sandi wajib diisi'),
})

type FormValues = z.infer<typeof schema>

export function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = async (v: FormValues) => {
    setPending(true)
    setError(null)
    try {
      await login(v.identifier, v.password)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal masuk')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-6 text-xl font-semibold">Masuk</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Email atau nama pengguna" htmlFor="identifier" error={errors.identifier?.message}>
            <Input
              id="identifier"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              {...register('identifier')}
            />
          </Field>
          <Field label="Kata sandi" htmlFor="password" error={errors.password?.message}>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
            />
          </Field>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Memproses…' : 'Masuk'}
          </Button>
        </form>
      </div>
    </div>
  )
}
