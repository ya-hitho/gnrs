import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Plus, Search, User as UserIcon } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import {
  createUser,
  deleteUser,
  getUser,
  listUsers,
  ROLE_LABEL,
  updateUser,
  USER_ROLES,
  type ManagedUser,
  type UserCreateInput,
  type UserRole,
  type UserUpdateInput,
} from '@/api/users'
import { ApiError } from '@/api/client'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { Field } from '@/components/Field'
import { Input } from '@/components/Input'
import { PhotoUploader } from '@/components/PhotoUploader'
import { RowActions } from '@/components/RowActions'
import { PageShell } from '@/components/PageShell'

const PAGE_SIZE = 25

type DialogMode = { kind: 'create' } | { kind: 'edit'; id: string } | null

export function UsersPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const q = params.get('q') ?? ''
  const roleParam = params.get('role')
  const role = (USER_ROLES as readonly string[]).includes(roleParam ?? '')
    ? (roleParam as UserRole)
    : undefined
  const activeParam = params.get('active')
  const active =
    activeParam === 'true' ? true : activeParam === 'false' ? false : undefined
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)

  const { user: me } = useAuth()
  const toast = useToast()
  const [dialog, setDialog] = useState<DialogMode>(null)

  const { data, isPending } = useQuery({
    queryKey: ['users', { q, role, active, page }],
    queryFn: () =>
      listUsers({
        q,
        role,
        active,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
  })

  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] })

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: invalidate,
  })

  const createMut = useMutation({
    mutationFn: (input: UserCreateInput) => createUser(input),
    onSuccess: (u) => {
      toast('Pengguna ditambahkan', 'success')
      invalidate()
      setDialog({ kind: 'edit', id: u.id })
    },
    onError: (e) => toast(apiMsg(e, 'Gagal menambah pengguna'), 'error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UserUpdateInput }) => updateUser(id, input),
    onSuccess: () => {
      toast('Pengguna diperbarui', 'success')
      invalidate()
      setDialog(null)
    },
    onError: (e) => toast(apiMsg(e, 'Gagal memperbarui pengguna'), 'error'),
  })

  const handleDelete = (u: ManagedUser) => {
    if (confirm(`Hapus pengguna ${u.name}? Tindakan ini tidak dapat dibatalkan.`)) {
      deleteMutation.mutate(u.id)
    }
  }

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const updateSearch = (next: { q?: string; role?: string; active?: string; page?: number }) => {
    const sp = new URLSearchParams()
    if (next.q) sp.set('q', next.q)
    if (next.role) sp.set('role', next.role)
    if (next.active) sp.set('active', next.active)
    if (next.page && next.page > 1) sp.set('page', String(next.page))
    navigate({ pathname: '/pengaturan/pengguna', search: sp.toString() ? `?${sp.toString()}` : '' })
  }

  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-xl font-semibold">Pengguna</h2>
        <p className="mt-1 text-sm text-slate-500">
          Kelola akun login dan role untuk semua pengguna sistem.
        </p>
      </div>
      <Button className="self-start sm:self-auto" onClick={() => setDialog({ kind: 'create' })}>
        <Plus size={16} className="mr-1" />
        Tambah Pengguna
      </Button>
    </div>
  )

  return (
    <PageShell header={header}>
      <div className="space-y-4">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          updateSearch({
            q: String(fd.get('q') ?? '') || undefined,
            role: String(fd.get('role') ?? '') || undefined,
            active: String(fd.get('active') ?? '') || undefined,
            page: 1,
          })
        }}
      >
        <div className="relative max-w-md flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <Input name="q" defaultValue={q} placeholder="Cari nama / email / username" className="pl-9" />
        </div>
        <select
          name="role"
          defaultValue={role ?? ''}
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <option value="">Semua role</option>
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <select
          name="active"
          defaultValue={active === undefined ? '' : String(active)}
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <option value="">Semua status</option>
          <option value="true">Aktif</option>
          <option value="false">Nonaktif</option>
        </select>
        <Button type="submit" variant="secondary" size="md">
          Terapkan
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 w-12"></th>
              <th className="px-4 py-2">Nama</th>
              <th className="hidden px-4 py-2 sm:table-cell">Email</th>
              <th className="hidden px-4 py-2 md:table-cell">Username</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isPending ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  Memuat…
                </td>
              </tr>
            ) : data && data.items.length > 0 ? (
              data.items.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Avatar url={u.photoUrl} />
                  </td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setDialog({ kind: 'edit', id: u.id })}
                      className="text-left text-slate-900 hover:underline"
                    >
                      {u.name}
                      {me?.id === u.id ? <span className="ml-2 text-xs text-slate-500">(saya)</span> : null}
                    </button>
                  </td>
                  <td className="hidden px-4 py-2 sm:table-cell">{u.email}</td>
                  <td className="hidden px-4 py-2 md:table-cell">{u.username ?? '—'}</td>
                  <td className="px-4 py-2">
                    <RolePill role={u.role} />
                  </td>
                  <td className="px-4 py-2">
                    <ActivePill active={u.active} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <RowActions
                      onEdit={() => setDialog({ kind: 'edit', id: u.id })}
                      onDelete={() => handleDelete(u)}
                      deleteDisabled={deleteMutation.isPending || me?.id === u.id}
                    />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  Belum ada pengguna.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Halaman {page} dari {totalPages} · {total} total
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() =>
              updateSearch({
                q,
                role,
                active: active === undefined ? undefined : String(active),
                page: Math.max(1, page - 1),
              })
            }
          >
            Sebelumnya
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() =>
              updateSearch({
                q,
                role,
                active: active === undefined ? undefined : String(active),
                page: Math.min(totalPages, page + 1),
              })
            }
          >
            Berikutnya
          </Button>
        </div>
      </div>

      {dialog?.kind === 'create' ? (
        <Dialog title="Tambah Pengguna" onClose={() => setDialog(null)}>
          <UserCreateForm
            pending={createMut.isPending}
            error={createMut.error}
            onSubmit={(input) => createMut.mutate(input)}
            onCancel={() => setDialog(null)}
          />
        </Dialog>
      ) : null}

      {dialog?.kind === 'edit' ? (
        <UserEditDialog
          id={dialog.id}
          pending={updateMut.isPending}
          error={updateMut.error}
          onSubmit={(input) => updateMut.mutate({ id: dialog.id, input })}
          onClose={() => setDialog(null)}
          onPhotoChanged={invalidate}
        />
      ) : null}
      </div>
    </PageShell>
  )
}

// --- Create form ----------------------------------------------------------

const createSchema = z.object({
  name: z.string().min(1, 'Wajib diisi').max(200),
  email: z.string().email('Format email tidak valid'),
  username: z.string().max(64).optional().or(z.literal('')),
  password: z.string().min(6, 'Minimal 6 karakter').max(128),
  role: z.enum(USER_ROLES as readonly [UserRole, ...UserRole[]]),
  // Taaruf-style biodata (all optional during create).
  nickname: z.string().max(200).optional().or(z.literal('')),
  userCode: z.string().max(40).optional().or(z.literal('')),
  noHp: z.string().max(64).optional().or(z.literal('')),
  tempatLahir: z.string().max(120).optional().or(z.literal('')),
  dateOfBirth: z.string().optional().or(z.literal('')),
  gender: z.enum(['', 'male', 'female']).optional(),
  daerah: z.string().max(200).optional().or(z.literal('')),
  desa: z.string().max(200).optional().or(z.literal('')),
  kelompok: z.string().max(200).optional().or(z.literal('')),
  pendidikan: z.string().max(80).optional().or(z.literal('')),
  pekerjaan: z.string().max(80).optional().or(z.literal('')),
})
type CreateValues = z.infer<typeof createSchema>

function UserCreateForm({
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  pending: boolean
  error: unknown
  onSubmit: (input: UserCreateInput) => void
  onCancel: () => void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: '',
      email: '',
      username: '',
      password: '',
      role: 'murid',
      nickname: '',
      userCode: '',
      noHp: '',
      tempatLahir: '',
      dateOfBirth: '',
      gender: '',
      daerah: '',
      desa: '',
      kelompok: '',
      pendidikan: '',
      pekerjaan: '',
    },
  })
  const apiError = error instanceof ApiError ? error.message : null

  return (
    <form
      onSubmit={handleSubmit((v) =>
        onSubmit({
          name: v.name,
          email: v.email,
          username: v.username || undefined,
          password: v.password,
          role: v.role,
          nickname: v.nickname || undefined,
          userCode: v.userCode || undefined,
          noHp: v.noHp || undefined,
          tempatLahir: v.tempatLahir || undefined,
          dateOfBirth: v.dateOfBirth || undefined,
          gender: v.gender === '' ? undefined : v.gender,
          daerah: v.daerah || undefined,
          desa: v.desa || undefined,
          kelompok: v.kelompok || undefined,
          pendidikan: v.pendidikan || undefined,
          pekerjaan: v.pekerjaan || undefined,
        }),
      )}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama lengkap" htmlFor="name" error={errors.name?.message}>
          <Input id="name" {...register('name')} />
        </Field>
        <Field label="Nama panggilan" htmlFor="nickname" error={errors.nickname?.message}>
          <Input id="nickname" {...register('nickname')} />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" {...register('email')} />
        </Field>
        <Field label="Username (opsional)" htmlFor="username" error={errors.username?.message}>
          <Input id="username" {...register('username')} />
        </Field>
        <Field label="Password awal" htmlFor="password" error={errors.password?.message}>
          <Input id="password" type="text" placeholder="Minimal 6 karakter" {...register('password')} />
        </Field>
        <Field label="Role" htmlFor="role" error={errors.role?.message}>
          <select
            id="role"
            {...register('role')}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kode pengguna (opsional)" htmlFor="userCode" error={errors.userCode?.message}>
          <Input id="userCode" placeholder="cth: CKR-001" {...register('userCode')} />
        </Field>
        <Field label="No. HP" htmlFor="noHp" error={errors.noHp?.message}>
          <Input id="noHp" {...register('noHp')} />
        </Field>
        <Field label="Tempat lahir" htmlFor="tempatLahir" error={errors.tempatLahir?.message}>
          <Input id="tempatLahir" {...register('tempatLahir')} />
        </Field>
        <Field label="Tanggal lahir" htmlFor="dateOfBirth" error={errors.dateOfBirth?.message}>
          <Input id="dateOfBirth" type="date" {...register('dateOfBirth')} />
        </Field>
        <Field label="Jenis kelamin" htmlFor="gender" error={errors.gender?.message}>
          <select
            id="gender"
            {...register('gender')}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <option value="">—</option>
            <option value="male">Laki-laki</option>
            <option value="female">Perempuan</option>
          </select>
        </Field>
        <Field label="Daerah" htmlFor="daerah" error={errors.daerah?.message}>
          <Input id="daerah" {...register('daerah')} />
        </Field>
        <Field label="Desa" htmlFor="desa" error={errors.desa?.message}>
          <Input id="desa" {...register('desa')} />
        </Field>
        <Field label="Kelompok" htmlFor="kelompok" error={errors.kelompok?.message}>
          <Input id="kelompok" {...register('kelompok')} />
        </Field>
        <Field label="Pendidikan" htmlFor="pendidikan" error={errors.pendidikan?.message}>
          <Input id="pendidikan" {...register('pendidikan')} />
        </Field>
        <Field label="Pekerjaan" htmlFor="pekerjaan" error={errors.pekerjaan?.message}>
          <Input id="pekerjaan" {...register('pekerjaan')} />
        </Field>
      </div>
      {apiError ? <p className="text-sm text-red-600">{apiError}</p> : null}
      <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </div>
    </form>
  )
}

// --- Edit dialog ----------------------------------------------------------

const editSchema = z.object({
  name: z.string().min(1, 'Wajib diisi').max(200),
  email: z.string().email('Format email tidak valid'),
  username: z.string().max(64).optional().or(z.literal('')),
  role: z.enum(USER_ROLES as readonly [UserRole, ...UserRole[]]),
  active: z.boolean(),
})
type EditValues = z.infer<typeof editSchema>

function UserEditDialog({
  id,
  pending,
  error,
  onSubmit,
  onClose,
  onPhotoChanged,
}: {
  id: string
  pending: boolean
  error: unknown
  onSubmit: (input: UserUpdateInput) => void
  onClose: () => void
  onPhotoChanged: () => void
}) {
  const qc = useQueryClient()
  const { data, isPending } = useQuery({
    queryKey: ['users', 'detail', id],
    queryFn: () => getUser(id),
  })

  return (
    <Dialog title={`Ubah Pengguna${data ? ` — ${data.name}` : ''}`} onClose={onClose}>
      {isPending ? (
        <div className="py-6 text-center text-slate-500">Memuat…</div>
      ) : data ? (
        <div className="space-y-4">
          <PhotoUploader
            userId={data.id}
            photoUrl={data.photoUrl ?? null}
            onChanged={() => {
              qc.invalidateQueries({ queryKey: ['users', 'detail', id] })
              onPhotoChanged()
            }}
          />
          <UserEditForm
            initial={data}
            pending={pending}
            error={error}
            onSubmit={onSubmit}
            onCancel={onClose}
          />
          <div className="border-t border-slate-200 pt-3 text-sm">
            <Link
              to={`/pengaturan/pengguna/${data.id}`}
              className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 hover:underline"
            >
              <ExternalLink size={14} /> Edit lengkap (profil, password, membership)
            </Link>
          </div>
        </div>
      ) : (
        <div className="py-6 text-center text-red-600">Data tidak ditemukan</div>
      )}
    </Dialog>
  )
}

function UserEditForm({
  initial,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial: ManagedUser
  pending: boolean
  error: unknown
  onSubmit: (input: UserUpdateInput) => void
  onCancel: () => void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: initial.name,
      email: initial.email,
      username: initial.username ?? '',
      role: initial.role,
      active: initial.active,
    },
  })
  const apiError = error instanceof ApiError ? error.message : null

  return (
    <form
      onSubmit={handleSubmit((v) =>
        onSubmit({
          name: v.name,
          email: v.email,
          username: v.username ?? '',
          role: v.role,
          active: v.active,
        }),
      )}
      className="space-y-3"
    >
      <Field label="Nama" htmlFor="e_name" error={errors.name?.message}>
        <Input id="e_name" {...register('name')} />
      </Field>
      <Field label="Email" htmlFor="e_email" error={errors.email?.message}>
        <Input id="e_email" type="email" {...register('email')} />
      </Field>
      <Field label="Username" htmlFor="e_username" error={errors.username?.message}>
        <Input id="e_username" placeholder="kosong = hapus username" {...register('username')} />
      </Field>
      <Field label="Role" htmlFor="e_role" error={errors.role?.message}>
        <select
          id="e_role"
          {...register('role')}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Aktif" htmlFor="e_active" error={errors.active?.message}>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" id="e_active" {...register('active')} className="h-4 w-4" />
          <span className="text-sm text-slate-600">Akun aktif (bisa login)</span>
        </label>
      </Field>
      {apiError ? <p className="text-sm text-red-600">{apiError}</p> : null}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </div>
    </form>
  )
}

// --- Helpers --------------------------------------------------------------

function apiMsg(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message || fallback
  return fallback
}

function Avatar({ url }: { url?: string | null }) {
  return (
    <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-50">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <UserIcon size={16} className="text-slate-300" />
      )}
    </div>
  )
}

function RolePill({ role }: { role: UserRole }) {
  const colors: Record<string, string> = {
    admin: 'bg-rose-100 text-rose-800',
    pengurus: 'bg-amber-100 text-amber-800',
    guru: 'bg-sky-100 text-sky-800',
    ortu: 'bg-violet-100 text-violet-800',
    murid: 'bg-emerald-100 text-emerald-800',
    staff: 'bg-slate-200 text-slate-700', // legacy
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        colors[role] ?? 'bg-slate-100 text-slate-700'
      }`}
    >
      {ROLE_LABEL[role] ?? role}
    </span>
  )
}

function ActivePill({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
        Aktif
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
      Nonaktif
    </span>
  )
}
