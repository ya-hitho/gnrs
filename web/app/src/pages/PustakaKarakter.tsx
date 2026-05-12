import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Pencil, Plus, Trash2 } from 'lucide-react'

import {
  createKarakter,
  deleteKarakter,
  deleteKarakterGroup,
  listKarakter,
  renameKarakterGroup,
  updateKarakter,
  type GroupRenameInput,
  type KarakterInput,
  type KarakterItem,
} from '@/api/karakter'
import { ApiError } from '@/api/client'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { Field } from '@/components/Field'
import { Input } from '@/components/Input'
import { LibraryShell } from '@/components/LibraryShell'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'

export function PustakaKarakterPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const toast = useToast()
  const qc = useQueryClient()

  const { data: items = [], isPending } = useQuery({
    queryKey: ['karakter-luhur'],
    queryFn: listKarakter,
  })

  const grouped = useMemo(() => {
    const map: Record<string, KarakterItem[]> = {}
    const order: { parent: string; urutan: number }[] = []
    for (const it of items) {
      if (!map[it.parent]) {
        map[it.parent] = []
        order.push({ parent: it.parent, urutan: it.parentUrutan })
      }
      map[it.parent].push(it)
    }
    order.sort((a, b) => a.urutan - b.urutan || a.parent.localeCompare(b.parent))
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => a.itemUrutan - b.itemUrutan || a.labelId.localeCompare(b.labelId))
    }
    return order.map((g) => ({ parent: g.parent, urutan: g.urutan, items: map[g.parent] }))
  }, [items])

  const [dialog, setDialog] = useState<
    | { kind: 'create'; defaults?: Partial<KarakterInput> }
    | { kind: 'edit'; item: KarakterItem }
    | { kind: 'group'; parent: string; parentEn?: string | null; urutan: number }
    | null
  >(null)

  const renameGroupMut = useMutation({
    mutationFn: ({ oldParent, input }: { oldParent: string; input: GroupRenameInput }) =>
      renameKarakterGroup(oldParent, input),
    onSuccess: () => {
      toast('Grup karakter diperbarui', 'success')
      qc.invalidateQueries({ queryKey: ['karakter-luhur'] })
      setDialog(null)
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Gagal memperbarui grup', 'error'),
  })

  const deleteGroupMut = useMutation({
    mutationFn: deleteKarakterGroup,
    onSuccess: (r) => {
      toast(`Grup dihapus (${r.deleted} item)`, 'success')
      qc.invalidateQueries({ queryKey: ['karakter-luhur'] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Gagal menghapus grup', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteKarakter,
    onSuccess: () => {
      toast('Karakter dihapus', 'success')
      qc.invalidateQueries({ queryKey: ['karakter-luhur'] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Gagal menghapus', 'error'),
  })

  return (
    <LibraryShell
      backTo="/pustaka"
      backLabel="Pustaka"
      bgClassName="bg-slate-50"
      contentClassName="px-4 pt-14 pb-6 md:px-8"
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">29 Karakter Luhur</h1>
            <p className="mt-1 text-sm text-slate-500">
              Tabiat luhur LDII per kurikulum PPG. Admin dapat menambah / mengubah / menghapus.
            </p>
          </div>
          {isAdmin ? (
            <Button size="sm" onClick={() => setDialog({ kind: 'create' })}>
              <Plus size={14} className="mr-1" /> Tambah Karakter
            </Button>
          ) : null}
        </div>
      {isPending ? (
        <p className="text-sm text-slate-500">Memuat…</p>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          Belum ada data karakter.
        </p>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => (
            <div
              key={g.parent}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
            >
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-emerald-50 px-4 py-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-bold uppercase tracking-wide text-emerald-800">
                    {g.parent}
                  </h3>
                  <p className="mt-0.5 text-xs text-emerald-700">{g.items.length} karakter</p>
                </div>
                {isAdmin ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setDialog({
                          kind: 'group',
                          parent: g.parent,
                          parentEn: g.items[0]?.parentEn ?? '',
                          urutan: g.urutan,
                        })
                      }
                      className="rounded-md p-1.5 text-emerald-700 transition hover:bg-emerald-100"
                      aria-label="Ubah grup"
                      title="Ubah nama grup"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          confirm(
                            `Hapus seluruh grup "${g.parent}" dan ${g.items.length} item di dalamnya?`,
                          )
                        ) {
                          deleteGroupMut.mutate(g.parent)
                        }
                      }}
                      disabled={deleteGroupMut.isPending}
                      className="rounded-md p-1.5 text-emerald-700 transition hover:bg-rose-100 hover:text-rose-700 disabled:opacity-50"
                      aria-label="Hapus grup"
                      title="Hapus seluruh grup"
                    >
                      <Trash2 size={14} />
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDialog({
                          kind: 'create',
                          defaults: {
                            parent: g.parent,
                            parentEn: g.items[0]?.parentEn ?? '',
                            parentUrutan: g.urutan,
                            itemUrutan: g.items.length,
                          },
                        })
                      }
                    >
                      <Plus size={14} className="mr-1" /> Item
                    </Button>
                  </div>
                ) : null}
              </div>
              <ul className="divide-y divide-slate-100">
                {g.items.map((k) => (
                  <li key={k.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-900">{k.labelId}</div>
                      {k.labelEn ? (
                        <div className="mt-0.5 text-xs italic text-slate-500">{k.labelEn}</div>
                      ) : null}
                      {k.catatan ? (
                        <div className="mt-1 text-sm text-slate-600">{k.catatan}</div>
                      ) : null}
                    </div>
                    {isAdmin ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: 'edit', item: k })}
                          className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                          aria-label="Ubah"
                          title="Ubah"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Hapus karakter "${k.labelId}"?`)) {
                              deleteMut.mutate(k.id)
                            }
                          }}
                          disabled={deleteMut.isPending}
                          className="rounded-md p-1.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                          aria-label="Hapus"
                          title="Hapus"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {dialog?.kind === 'create' ? (
        <KarakterFormDialog
          defaults={dialog.defaults}
          onClose={() => setDialog(null)}
          onSaved={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <KarakterFormDialog
          item={dialog.item}
          onClose={() => setDialog(null)}
          onSaved={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'group' ? (
        <GroupRenameDialog
          oldParent={dialog.parent}
          defaultParentEn={dialog.parentEn ?? ''}
          defaultUrutan={dialog.urutan}
          pending={renameGroupMut.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(input) =>
            renameGroupMut.mutate({ oldParent: dialog.parent, input })
          }
        />
      ) : null}
      </div>
    </LibraryShell>
  )
}

function GroupRenameDialog({
  oldParent,
  defaultParentEn,
  defaultUrutan,
  pending,
  onClose,
  onSubmit,
}: {
  oldParent: string
  defaultParentEn: string
  defaultUrutan: number
  pending: boolean
  onClose: () => void
  onSubmit: (input: GroupRenameInput) => void
}) {
  const [parent, setParent] = useState(oldParent)
  const [parentEn, setParentEn] = useState(defaultParentEn)
  const [urutan, setUrutan] = useState(defaultUrutan)

  return (
    <Dialog title="Ubah Grup Karakter" onClose={onClose} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit({
            parent: parent.trim(),
            parentEn: parentEn.trim() || null,
            parentUrutan: urutan,
          })
        }}
        className="space-y-4"
      >
        <Field label="Nama grup (Indonesia)" htmlFor="grp-parent">
          <Input
            id="grp-parent"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            autoFocus
            required
          />
        </Field>
        <Field label="Nama grup (English)" htmlFor="grp-parentEn">
          <Input
            id="grp-parentEn"
            value={parentEn}
            onChange={(e) => setParentEn(e.target.value)}
          />
        </Field>
        <Field label="Urutan grup" htmlFor="grp-urutan">
          <Input
            id="grp-urutan"
            type="number"
            min={0}
            value={urutan}
            onChange={(e) => setUrutan(Number(e.target.value))}
          />
        </Field>
        <p className="text-xs text-slate-500">
          Perubahan diterapkan ke seluruh item di grup "{oldParent}".
        </p>
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
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

// ---------------------------------------------------------------------------

const schema = z.object({
  parent: z.string().min(1, 'Wajib').max(200),
  parentEn: z.string().optional().or(z.literal('')),
  parentUrutan: z.coerce.number().int().gte(0).lte(1000),
  labelId: z.string().min(1, 'Wajib').max(300),
  labelEn: z.string().optional().or(z.literal('')),
  itemUrutan: z.coerce.number().int().gte(0).lte(1000),
  catatan: z.string().optional().or(z.literal('')),
})
type FormValues = z.infer<typeof schema>

function KarakterFormDialog({
  item,
  defaults,
  onClose,
  onSaved,
}: {
  item?: KarakterItem
  defaults?: Partial<KarakterInput>
  onClose: () => void
  onSaved: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      parent: item?.parent ?? defaults?.parent ?? '',
      parentEn: item?.parentEn ?? defaults?.parentEn ?? '',
      parentUrutan: item?.parentUrutan ?? defaults?.parentUrutan ?? 0,
      labelId: item?.labelId ?? '',
      labelEn: item?.labelEn ?? '',
      itemUrutan: item?.itemUrutan ?? defaults?.itemUrutan ?? 0,
      catatan: item?.catatan ?? '',
    },
  })

  const mut = useMutation({
    mutationFn: (input: KarakterInput) =>
      item ? updateKarakter(item.id, input) : createKarakter(input),
    onSuccess: () => {
      toast(item ? 'Karakter diperbarui' : 'Karakter ditambah', 'success')
      qc.invalidateQueries({ queryKey: ['karakter-luhur'] })
      onSaved()
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Gagal menyimpan', 'error'),
  })

  return (
    <Dialog title={item ? 'Ubah Karakter' : 'Tambah Karakter'} onClose={onClose} size="md">
      <form
        onSubmit={handleSubmit((v) =>
          mut.mutate({
            parent: v.parent.trim(),
            parentEn: v.parentEn?.trim() || null,
            parentUrutan: v.parentUrutan,
            labelId: v.labelId.trim(),
            labelEn: v.labelEn?.trim() || null,
            itemUrutan: v.itemUrutan,
            catatan: v.catatan?.trim() || null,
          }),
        )}
        className="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Grup (parent)" htmlFor="parent" error={errors.parent?.message}>
            <Input id="parent" placeholder="cth: 6 Tabi'at Luhur" {...register('parent')} />
          </Field>
          <Field label="Grup (English)" htmlFor="parentEn" error={errors.parentEn?.message}>
            <Input id="parentEn" placeholder="cth: 6 Noble Traits" {...register('parentEn')} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Urutan grup" htmlFor="parentUrutan" error={errors.parentUrutan?.message}>
            <Input
              id="parentUrutan"
              type="number"
              min={0}
              {...register('parentUrutan', { valueAsNumber: true })}
            />
          </Field>
          <Field label="Urutan dalam grup" htmlFor="itemUrutan" error={errors.itemUrutan?.message}>
            <Input
              id="itemUrutan"
              type="number"
              min={0}
              {...register('itemUrutan', { valueAsNumber: true })}
            />
          </Field>
        </div>
        <Field label="Nama (Indonesia)" htmlFor="labelId" error={errors.labelId?.message}>
          <Input id="labelId" autoFocus {...register('labelId')} />
        </Field>
        <Field label="Nama (English)" htmlFor="labelEn" error={errors.labelEn?.message}>
          <Input id="labelEn" {...register('labelEn')} />
        </Field>
        <Field label="Catatan / deskripsi (opsional)" htmlFor="catatan" error={errors.catatan?.message}>
          <textarea
            id="catatan"
            rows={3}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            {...register('catatan')}
          />
        </Field>
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={mut.isPending}>
            Batal
          </Button>
          <Button type="submit" disabled={mut.isPending}>
            {mut.isPending ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
