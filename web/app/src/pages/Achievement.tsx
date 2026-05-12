import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronRight, Minus, Search, X } from 'lucide-react'

import {
  listPencapaian,
  upsertPencapaian,
  type PencapaianRow,
  type PencapaianStatus,
} from '@/api/pencapaian'
import { listBacaan } from '@/api/bacaan'
import { listTingkat, type MateriAjar } from '@/api/kurikulum'
import { listStudents } from '@/api/students'
import { ageInYears } from '@/lib/age'
import { ApiError } from '@/api/client'
import { Dialog } from '@/components/Dialog'
import { Field } from '@/components/Field'
import { Input } from '@/components/Input'
import { PageShell, PageHeader } from '@/components/PageShell'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/cn'

/**
 * Pencapaian — per-murid mastery tracker, ported from sitrac-v3.
 * Same hierarchical tree as Settings → Kurikulum (tema → sub-tema →
 * kelompok → materi) with a progress bar aligned at each level.
 *
 * Filter: pick a murid + optional umur range (kurikulum is age-graded,
 * so umur from-to lets you check progress across a developmental window).
 */

const TEMA_ORDER = ['ALIM', 'FAQIH', 'AKHLAQUL KARIMAH', 'KEMANDIRIAN']
const TEMA_LABEL: Record<string, string> = {
  ALIM: '🕌 Alim',
  FAQIH: '📚 Faqih',
  'AKHLAQUL KARIMAH': '✨ Akhlaqul Karimah',
  KEMANDIRIAN: '🎯 Kemandirian',
}
const TEMA_COLOR: Record<string, string> = {
  ALIM: '#5b6f4e',
  FAQIH: '#b88a3a',
  'AKHLAQUL KARIMAH': '#8a5cd6',
  KEMANDIRIAN: '#3a8a8a',
}

const STATUS_CYCLE: PencapaianStatus[] = ['belum', 'proses', 'tuntas']

export function AchievementPage() {
  const [tab, setTab] = useState<'kurikulum' | 'library'>('kurikulum')
  return (
    <PageShell
      header={
        <PageHeader
          eyebrow="Pencapaian"
          title="Tracker pencapaian murid"
          subtitle="Pilih tab untuk melihat kurikulum atau library tracker."
        />
      }
    >
      <div className="mb-4 flex border-b border-slate-200">
        <TabButton active={tab === 'kurikulum'} onClick={() => setTab('kurikulum')}>
          Kurikulum
        </TabButton>
        <TabButton active={tab === 'library'} onClick={() => setTab('library')}>
          Library
        </TabButton>
      </div>
      {tab === 'kurikulum' ? <KurikulumTab /> : <LibraryTab />}
    </PageShell>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px px-4 py-2 text-sm font-medium transition border-b-2',
        active
          ? 'border-slate-900 text-slate-900'
          : 'border-transparent text-slate-500 hover:text-slate-700',
      )}
    >
      {children}
    </button>
  )
}

function KurikulumTab() {
  const { user } = useAuth()
  const isMurid = user?.role === 'murid'
  const canEdit = user?.role === 'admin' || user?.role === 'pengurus' || user?.role === 'guru'

  const [muridUserId, setMuridUserId] = useState<string>(isMurid ? user!.id : '')
  // (umur, semester) pair as the filter unit. `fromKey` and `toKey` are
  // strings like "5-1" (5 tahun, semester 1).
  const [fromKey, setFromKey] = useState<string>('')
  const [toKey, setToKey] = useState<string>('')
  // Track which murid id we last auto-defaulted for — so picking a new
  // murid resets the filter to their umur, but manual edits afterwards
  // aren't clobbered on re-renders.
  const autoDefaultedFor = useRef<string>('')

  const { data: students } = useQuery({
    queryKey: ['students', { all: true }],
    queryFn: () => listStudents({ status: 'active', limit: 500 }),
    enabled: !isMurid,
    staleTime: 60_000,
  })

  const { data: tingkatList = [] } = useQuery({
    queryKey: ['tingkat'],
    queryFn: listTingkat,
    staleTime: 5 * 60_000,
  })

  // Build (umur, semester) options from tingkat. Each tingkat with umur
  // produces two options (sem 1 + sem 2). Sorted by umur ascending then
  // semester. Label looks like "5 th · Sem 1 · TK-A".
  const umurSemOptions = useMemo(() => {
    type Opt = { key: string; umur: number; sem: 1 | 2; label: string; tingkat: string }
    const opts: Opt[] = []
    for (const t of tingkatList) {
      if (typeof t.umur !== 'number') continue
      for (const sem of [1, 2] as const) {
        opts.push({
          key: `${t.umur}-${sem}`,
          umur: t.umur,
          sem,
          tingkat: t.nama,
          label: `${t.umur} th · Sem ${sem} · ${t.nama}`,
        })
      }
    }
    opts.sort((a, b) => (a.umur - b.umur) || (a.sem - b.sem) || a.tingkat.localeCompare(b.tingkat))
    return opts
  }, [tingkatList])

  // Parse the (umur, sem) tuple from a key string.
  const parseKey = (k: string): { umur: number; sem: 1 | 2 } | null => {
    const m = k.match(/^(\d+)-([12])$/)
    if (!m) return null
    return { umur: Number(m[1]), sem: Number(m[2]) as 1 | 2 }
  }

  const fromParsed = parseKey(fromKey)
  const toParsed = parseKey(toKey)

  // Auto-set "Umur dari" + "Umur sampai" when a murid is freshly picked.
  // Default to (murid's age, current semester) — 1-semester window.
  // Semester: bulan Juli (idx 6) sampai Desember = Sem 1; Jan–Jun = Sem 2.
  // Fallback chain: dateOfBirth → level→tingkat.umur → first available umur.
  useEffect(() => {
    if (!muridUserId) return
    if (autoDefaultedFor.current === muridUserId) return
    // Need both queries resolved to make a decision.
    if (!students || tingkatList.length === 0) return
    const murid = students.items.find((s) => s.id === muridUserId)
    if (!murid) return
    let age: number | null = null
    if (murid.dateOfBirth) {
      age = ageInYears(murid.dateOfBirth)
    }
    if (age == null && murid.level) {
      // Match the murid's level (e.g. "sd-1") to a tingkat name and pull
      // its umur. The tingkat seed uses uppercase names like "SD-1" or
      // "PAUD (TK)" — compare case-insensitively against the level slug.
      const slug = murid.level.toLowerCase()
      const t = tingkatList.find(
        (t) =>
          t.nama.toLowerCase().includes(slug) ||
          slug.includes(t.nama.toLowerCase().replace(/[^a-z0-9-]/g, '')),
      )
      if (t?.umur != null) age = t.umur
    }
    if (age == null && umurSemOptions.length > 0) {
      // Last-resort: pick the earliest tingkat with a known umur.
      age = umurSemOptions[0].umur
    }
    if (age == null) return
    // Cap at curriculum max (18 th). When the murid is older, snap to
    // "18 th · Sem 2" — the last semester window in the syllabus.
    let sem: 1 | 2 = new Date().getMonth() >= 6 ? 1 : 2
    if (age > 18) {
      age = 18
      sem = 2
    }
    const key = `${age}-${sem}`
    setFromKey(key)
    setToKey(key)
    autoDefaultedFor.current = muridUserId
  }, [muridUserId, students, tingkatList, umurSemOptions])

  const { data: rows = [], isPending } = useQuery({
    queryKey: ['pencapaian', muridUserId, fromKey, toKey],
    queryFn: () =>
      listPencapaian({
        muridUserId,
        fromUmur: fromParsed?.umur,
        fromSem: fromParsed?.sem,
        toUmur: toParsed?.umur,
        toSem: toParsed?.sem,
      }),
    enabled: Boolean(muridUserId),
  })

  return (
    <div className="space-y-4">
        {/* Filter card */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="space-y-3">
            <Field label="Murid" htmlFor="p-murid">
              {isMurid ? (
                <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm">
                  {user?.name}
                </div>
              ) : (
                <MuridPicker
                  students={students?.items ?? []}
                  value={muridUserId}
                  onChange={setMuridUserId}
                />
              )}
            </Field>
            {/* Umur dari + Umur sampai — mobile 2-col, desktop 2-col too.
                Default to 1-semester window: picking "Umur dari" auto-fills
                "Umur sampai" with the same key. User can broaden the range
                by changing "Umur sampai" independently. */}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Umur dari" htmlFor="p-from-key">
                <UmurSemCombo
                  id="p-from-key"
                  options={umurSemOptions}
                  value={fromKey}
                  onChange={(v) => {
                    setFromKey(v)
                    // Auto-mirror to "Umur sampai" unless user has
                    // explicitly widened the range past the new fromKey.
                    if (!toKey || toKey === fromKey) setToKey(v)
                    else {
                      const a = parseKey(v)
                      const b = parseKey(toKey)
                      if (a && b && (b.umur < a.umur || (b.umur === a.umur && b.sem < a.sem))) {
                        setToKey(v)
                      }
                    }
                  }}
                  placeholder="cth: 5 th · Sem 1"
                />
              </Field>
              <Field label="Umur sampai" htmlFor="p-to-key">
                <UmurSemCombo
                  id="p-to-key"
                  options={umurSemOptions}
                  value={toKey}
                  onChange={setToKey}
                  placeholder={fromKey || 'sama dengan dari'}
                />
              </Field>
            </div>
          </div>
        </div>

        {!muridUserId ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
            Pilih murid untuk melihat pencapaian.
          </div>
        ) : isPending ? (
          <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
            Memuat pencapaian…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
            Belum ada materi pada filter ini.
          </div>
        ) : (
          <PencapaianTree rows={rows} canEdit={canEdit} muridUserId={muridUserId} />
        )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function MuridPicker({
  students,
  value,
  onChange,
}: {
  students: { id: string; name: string; nickname?: string | null }[]
  value: string
  onChange: (v: string) => void
}) {
  const [search, setSearch] = useState('')
  const picked = students.find((s) => s.id === value)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return students.slice(0, 30)
    return students
      .filter(
        (s) => s.name.toLowerCase().includes(q) || (s.nickname ?? '').toLowerCase().includes(q),
      )
      .slice(0, 50)
  }, [students, search])
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <Input
          id="p-murid"
          value={open ? search : picked?.name ?? ''}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setSearch(e.target.value)
            if (!open) setOpen(true)
          }}
          placeholder="Cari murid…"
          className="pl-8 pr-8"
        />
        {picked ? (
          <button
            type="button"
            onClick={() => {
              onChange('')
              setSearch('')
              setOpen(false)
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Hapus pilihan murid"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
      {open ? (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">Tidak ada murid yang cocok.</p>
          ) : (
            filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onChange(s.id)
                  setSearch('')
                  setOpen(false)
                }}
                className={
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition ' +
                  (s.id === value ? 'bg-sky-50' : 'hover:bg-slate-50')
                }
              >
                <span className="flex-1 truncate">{s.name}</span>
                {s.nickname ? (
                  <span className="text-[10px] text-slate-500">{s.nickname}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

// UmurSemCombo — search-as-you-type combobox for picking a (umur, semester)
// option. Used for both "Umur dari" and "Umur sampai" in the filter card.
function UmurSemCombo({
  id,
  options,
  value,
  onChange,
  placeholder,
}: {
  id: string
  options: { key: string; umur: number; sem: 1 | 2; label: string; tingkat: string }[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const picked = options.find((o) => o.key === value)
  const display = picked ? `${picked.umur} th · Sem ${picked.sem}` : ''
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) =>
        String(o.umur).includes(q) ||
        o.tingkat.toLowerCase().includes(q) ||
        o.label.toLowerCase().includes(q),
    )
  }, [options, search])
  return (
    <div className="relative">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <Input
          id={id}
          value={open ? search : display}
          onFocus={() => {
            setOpen(true)
            setSearch('')
          }}
          onChange={(e) => {
            setSearch(e.target.value)
            if (!open) setOpen(true)
          }}
          placeholder={placeholder}
          className="pl-8 pr-7"
        />
        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange('')
              setSearch('')
              setOpen(false)
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Hapus"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
      {open ? (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">Tidak ditemukan.</p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => {
                  onChange(o.key)
                  setSearch('')
                  setOpen(false)
                }}
                className={
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition ' +
                  (o.key === value ? 'bg-sky-50' : 'hover:bg-slate-50')
                }
              >
                <span className="font-medium tabular-nums">{o.umur} th</span>
                <span className="text-xs text-slate-500">Sem {o.sem}</span>
                <span className="ml-auto text-[10px] text-slate-500">{o.tingkat}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

// --------------------------------------------------------------- Pencapaian tree

type Grouped = {
  tema: string
  rows: PencapaianRow[]
  subs: {
    subTema: string
    rows: PencapaianRow[]
    kelompoks: { kelompokMateri: string; rows: PencapaianRow[] }[]
    flat: PencapaianRow[]
  }[]
}

function PencapaianTree({
  rows,
  canEdit,
  muridUserId,
}: {
  rows: PencapaianRow[]
  canEdit: boolean
  muridUserId: string
}) {
  const grouped = useMemo(() => groupRows(rows), [rows])

  const [openTemas, setOpenTemas] = useState<Set<string>>(new Set())
  const [openSubs, setOpenSubs] = useState<Set<string>>(new Set())
  const [openKels, setOpenKels] = useState<Set<string>>(new Set())

  const toggle = (s: Set<string>, key: string, setter: (s: Set<string>) => void) =>
    setter(new Set(s.has(key) ? [...s].filter((x) => x !== key) : [...s, key]))

  const overall = useMemo(() => stats(rows), [rows])

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Progress keseluruhan
        </div>
        <ProgressRow stats={overall} />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {grouped.map((g) => {
          const tCollapsed = !openTemas.has(g.tema)
          const color = TEMA_COLOR[g.tema] || '#475569'
          const s = stats(g.rows)
          return (
            <div
              key={g.tema}
              className="border-b border-slate-100 last:border-b-0"
              style={{ borderLeft: `4px solid ${color}` }}
            >
              <button
                type="button"
                onClick={() => toggle(openTemas, g.tema, setOpenTemas)}
                className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)_8rem_3rem] items-center gap-2 px-3 py-2 text-left transition hover:bg-slate-50"
                style={{ color }}
              >
                {tCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span className="truncate font-semibold">{TEMA_LABEL[g.tema] || g.tema}</span>
                <MiniBar stats={s} />
                <span className="text-right text-xs font-medium tabular-nums">{s.pct}%</span>
              </button>
              {!tCollapsed
                ? g.subs.map((sub) => {
                    const subKey = `${g.tema}::${sub.subTema}`
                    const sCollapsed = !openSubs.has(subKey)
                    const subS = stats(sub.rows)
                    return (
                      <div key={subKey} className="border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => toggle(openSubs, subKey, setOpenSubs)}
                          className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)_8rem_3rem] items-center gap-2 px-5 py-1.5 text-left transition hover:bg-slate-50"
                        >
                          {sCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                          <span className="truncate text-sm font-medium">{sub.subTema}</span>
                          <MiniBar stats={subS} />
                          <span className="text-right text-xs font-medium tabular-nums">
                            {subS.pct}%
                          </span>
                        </button>
                        {!sCollapsed ? (
                          <div>
                            {sub.kelompoks.map((kg) => {
                              const kKey = `${subKey}::${kg.kelompokMateri}`
                              const kCollapsed = !openKels.has(kKey)
                              const kelS = stats(kg.rows)
                              return (
                                <div key={kKey} className="border-t border-slate-100">
                                  <button
                                    type="button"
                                    onClick={() => toggle(openKels, kKey, setOpenKels)}
                                    className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)_8rem_3rem] items-center gap-2 px-7 py-1.5 text-left transition hover:bg-slate-50"
                                  >
                                    {kCollapsed ? (
                                      <ChevronRight size={12} />
                                    ) : (
                                      <ChevronDown size={12} />
                                    )}
                                    <span className="truncate text-[11px] uppercase tracking-wide text-slate-600">
                                      {kg.kelompokMateri}
                                    </span>
                                    <MiniBar stats={kelS} />
                                    <span className="text-right text-xs font-medium tabular-nums">
                                      {kelS.pct}%
                                    </span>
                                  </button>
                                  {!kCollapsed ? (
                                    <ul className="bg-slate-50/50">
                                      {kg.rows.map((r) => (
                                        <MateriRow
                                          key={r.materi.id}
                                          row={r}
                                          canEdit={canEdit}
                                          muridUserId={muridUserId}
                                        />
                                      ))}
                                    </ul>
                                  ) : null}
                                </div>
                              )
                            })}
                            {sub.flat.length > 0 ? (
                              <ul className="bg-slate-50/50">
                                {sub.flat.map((r) => (
                                  <MateriRow
                                    key={r.materi.id}
                                    row={r}
                                    canEdit={canEdit}
                                    muridUserId={muridUserId}
                                  />
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })
                : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function groupRows(rows: PencapaianRow[]): Grouped[] {
  const byTema: Record<string, PencapaianRow[]> = {}
  for (const r of rows) {
    const tema = (r.materi.tema || '').toUpperCase() || '(TANPA TEMA)'
    ;(byTema[tema] = byTema[tema] || []).push(r)
  }
  const orderedKeys = [
    ...TEMA_ORDER.filter((k) => byTema[k]),
    ...Object.keys(byTema).filter((k) => !TEMA_ORDER.includes(k)).sort(),
  ]
  return orderedKeys.map<Grouped>((tema) => {
    const subBuckets: Record<string, PencapaianRow[]> = {}
    const subOrder: string[] = []
    for (const r of byTema[tema]) {
      const sub = r.materi.subTema || '—'
      if (!subBuckets[sub]) {
        subBuckets[sub] = []
        subOrder.push(sub)
      }
      subBuckets[sub].push(r)
    }
    const subs = subOrder.map((subTema) => {
      const subRows = subBuckets[subTema]
      const byKel: Record<string, PencapaianRow[]> = {}
      const kelOrder: string[] = []
      for (const r of subRows) {
        const k = (r.materi.kelompokMateri || '').trim()
        if (!byKel[k]) {
          byKel[k] = []
          kelOrder.push(k)
        }
        byKel[k].push(r)
      }
      const kelompoks = kelOrder
        .filter((k) => k && byKel[k].length >= 2)
        .map((kelompokMateri) => ({ kelompokMateri, rows: byKel[kelompokMateri] }))
      const groupedIds = new Set(kelompoks.flatMap((kg) => kg.rows.map((x) => x.materi.id)))
      const flat = subRows.filter((x) => !groupedIds.has(x.materi.id))
      return { subTema, rows: subRows, kelompoks, flat }
    })
    return { tema, rows: byTema[tema], subs }
  })
}

type Stats = { total: number; tuntas: number; proses: number; pct: number }

function stats(rows: PencapaianRow[]): Stats {
  const total = rows.length
  let tuntas = 0
  let proses = 0
  for (const r of rows) {
    const s = r.pencapaian?.status
    if (s === 'tuntas') tuntas++
    else if (s === 'proses') proses++
  }
  const pct = total > 0 ? Math.round((tuntas / total) * 100) : 0
  return { total, tuntas, proses, pct }
}

function MiniBar({ stats: s }: { stats: Stats }) {
  if (s.total === 0) {
    return <div className="h-2 w-full rounded-full bg-slate-100" />
  }
  const tuntasPct = (s.tuntas / s.total) * 100
  const prosesPct = (s.proses / s.total) * 100
  return (
    <div
      className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100"
      title={`${s.tuntas}/${s.total} tuntas, ${s.proses} proses`}
    >
      <div className="bg-emerald-500" style={{ width: `${tuntasPct}%` }} />
      <div className="bg-amber-400" style={{ width: `${prosesPct}%` }} />
    </div>
  )
}

function ProgressRow({ stats: s }: { stats: Stats }) {
  return (
    <div className="mt-1">
      <div className="text-2xl font-semibold text-emerald-900">
        {s.tuntas}{' '}
        <span className="text-base font-normal text-emerald-700">
          / {s.total} tuntas · {s.pct}%
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-emerald-200">
        <div className="h-full bg-emerald-600" style={{ width: `${s.pct}%` }} />
      </div>
      {s.proses > 0 ? (
        <div className="mt-1 text-xs text-amber-700">{s.proses} dalam proses</div>
      ) : null}
    </div>
  )
}

// -------------------------------------------------------------- Materi row

function MateriRow({
  row,
  canEdit,
  muridUserId,
}: {
  row: PencapaianRow
  canEdit: boolean
  muridUserId: string
}) {
  const m: MateriAjar = row.materi
  const status: PencapaianStatus = row.pencapaian?.status ?? 'belum'
  const toast = useToast()
  const qc = useQueryClient()
  const mut = useMutation({
    mutationFn: (next: PencapaianStatus) =>
      upsertPencapaian({
        muridUserId,
        materiAjarId: m.id,
        status: next,
        tanggal: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pencapaian', muridUserId] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Gagal simpan', 'error'),
  })

  const cycle = () => {
    const i = STATUS_CYCLE.indexOf(status)
    mut.mutate(STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length])
  }

  return (
    <li>
      <div className="flex items-start gap-3 px-9 py-1.5 text-sm">
        <button
          type="button"
          onClick={canEdit ? cycle : undefined}
          disabled={!canEdit || mut.isPending}
          className={cn(
            'mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition',
            status === 'tuntas'
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : status === 'proses'
              ? 'border-amber-500 bg-amber-100 text-amber-700'
              : 'border-slate-300 bg-white text-transparent',
            canEdit && 'hover:border-emerald-400',
            !canEdit && 'cursor-default opacity-70',
          )}
          aria-label={`Status: ${status}`}
          title={`Status: ${status} — klik untuk ubah`}
        >
          {status === 'tuntas' ? (
            <Check size={14} />
          ) : status === 'proses' ? (
            <Minus size={14} />
          ) : null}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-slate-500">
            Sem {m.semester} · {m.kodeMateri}
            {row.umur != null ? ` · ${row.umur} th` : ''}
          </div>
          <div className={status === 'tuntas' ? 'font-medium text-slate-900' : 'text-slate-800'}>
            {m.detailMateri}
          </div>
          {row.pencapaian?.catatan ? (
            <div className="mt-0.5 text-xs text-slate-500">{row.pencapaian.catatan}</div>
          ) : null}
        </div>
      </div>
    </li>
  )
}

// =========================================================== Library tab

type RangePreset = '1m' | '3m' | 's1' | 's2' | '1y'

function LibraryTab() {
  const { user } = useAuth()
  const isMurid = user?.role === 'murid'
  const [muridUserId, setMuridUserId] = useState<string>(isMurid ? user!.id : '')
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const [fromDate, setFromDate] = useState<string>(iso(new Date(today.getFullYear(), today.getMonth() - 1, today.getDate())))
  const [toDate, setToDate] = useState<string>(iso(today))

  const applyPreset = (p: RangePreset) => {
    const now = new Date()
    let f = new Date(now)
    let t = new Date(now)
    if (p === '1m') f.setMonth(now.getMonth() - 1)
    else if (p === '3m') f.setMonth(now.getMonth() - 3)
    else if (p === '1y') f.setFullYear(now.getFullYear() - 1)
    else if (p === 's1') {
      // Semester 1 = Juli–Desember
      const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
      f = new Date(year, 6, 1)
      t = new Date(year, 11, 31)
    } else if (p === 's2') {
      // Semester 2 = Januari–Juni
      const year = now.getMonth() < 6 ? now.getFullYear() : now.getFullYear() + 1
      f = new Date(year, 0, 1)
      t = new Date(year, 5, 30)
    }
    setFromDate(iso(f))
    setToDate(iso(t))
  }

  const { data: students } = useQuery({
    queryKey: ['students', { all: true }],
    queryFn: () => listStudents({ status: 'active', limit: 500 }),
    enabled: !isMurid,
    staleTime: 60_000,
  })

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="space-y-3">
          <Field label="Murid" htmlFor="lib-murid">
            {isMurid ? (
              <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm">
                {user?.name}
              </div>
            ) : (
              <MuridPicker
                students={students?.items ?? []}
                value={muridUserId}
                onChange={setMuridUserId}
              />
            )}
          </Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Dari" htmlFor="lib-from">
              <Input
                id="lib-from"
                type="date"
                className="w-full min-w-0"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </Field>
            <Field label="Sampai" htmlFor="lib-to">
              <Input
                id="lib-to"
                type="date"
                className="w-full min-w-0"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([
              ['1m', '1 bulan'],
              ['3m', '3 bulan'],
              ['s1', 'Sem 1'],
              ['s2', 'Sem 2'],
              ['1y', '1 tahun'],
            ] as [RangePreset, string][]).map(([p, lbl]) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPreset(p)}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!muridUserId ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
          Pilih murid untuk melihat library tracker.
        </div>
      ) : (
        <LibraryTrackerGrid muridUserId={muridUserId} fromDate={fromDate} toDate={toDate} />
      )}
    </div>
  )
}

const QURAN_TOTAL_AYAT = 6236
const TILAWATI_TOTAL_PAGES = 268 // 46*5 + 42
const HADITS_HIMPUNAN_PAGES = 2607 // sum of seeded jumlah_halaman across 24 kitab himpunan

function LibraryTrackerGrid({
  muridUserId,
  fromDate,
  toDate,
}: {
  muridUserId: string
  fromDate: string
  toDate: string
}) {
  const [picked, setPicked] = useState<null | { key: string; title: string }>(null)
  // Pull all bacaan_log rows for the murid in the date range. From this we
  // derive Quran reciting/manqul/hafalan via source/aspect proxy.
  const { data: logs = [] } = useQuery({
    queryKey: ['bacaan', muridUserId, fromDate, toDate],
    queryFn: () => listBacaan({ userId: muridUserId, from: fromDate, to: toDate, limit: 1000 }),
  })

  // Aggregate ayat count by category. For now we treat:
  //   reciting   = all logs (default reading tracker)
  //   hafalan    = logs with source='pengajian' as proxy
  //   manqul     = count of distinct (surah, ayat) entries with the catatan
  //                field filled — a hint that user wrote a manqul note.
  const aggregates = useMemo(() => {
    let recAyat = 0
    let hafAyat = 0
    let manqulAyat = 0
    for (const l of logs) {
      const n = Math.max(0, (l.ayatTo ?? l.ayatFrom) - l.ayatFrom + 1)
      recAyat += n
      if (l.source === 'pengajian') hafAyat += n
      if (l.catatan && l.catatan.trim() !== '') manqulAyat += n
    }
    return { recAyat, hafAyat, manqulAyat }
  }, [logs])

  const trackers = [
    {
      key: 'quran-reciting',
      title: "Al-Qur'an — Bacaan",
      icon: '📖',
      done: Math.min(aggregates.recAyat, QURAN_TOTAL_AYAT),
      total: QURAN_TOTAL_AYAT,
      unit: 'ayat',
    },
    {
      key: 'quran-manqul',
      title: "Al-Qur'an — Manqul",
      icon: '✍️',
      done: Math.min(aggregates.manqulAyat, QURAN_TOTAL_AYAT),
      total: QURAN_TOTAL_AYAT,
      unit: 'ayat',
    },
    {
      key: 'quran-hafalan',
      title: "Al-Qur'an — Hafalan",
      icon: '🧠',
      done: Math.min(aggregates.hafAyat, QURAN_TOTAL_AYAT),
      total: QURAN_TOTAL_AYAT,
      unit: 'ayat',
    },
    {
      key: 'hadits-manqul',
      title: 'Hadits Himpunan — Manqul',
      icon: '📜',
      done: 0,
      total: HADITS_HIMPUNAN_PAGES,
      unit: 'halaman',
      hint: 'Belum tersambung — perlu data manqul hadits',
    },
    {
      key: 'tilawati',
      title: 'Tilawati — Bacaan',
      icon: '📚',
      done: 0,
      total: TILAWATI_TOTAL_PAGES,
      unit: 'halaman',
      hint: 'Belum tersambung — perlu data sesi tilawati',
    },
    {
      key: 'doa-hafalan',
      title: "Doa-doa — Hafalan",
      icon: '🤲',
      done: 0,
      total: 0,
      unit: 'doa',
      hint: 'Total doa = jumlah doa di library; data hafalan belum tersambung',
    },
  ]

  // Filter the logs that match the picked tracker (for the popup detail).
  const pickedLogs = useMemo(() => {
    if (!picked) return []
    switch (picked.key) {
      case 'quran-reciting':
        return logs
      case 'quran-manqul':
        return logs.filter((l) => l.catatan && l.catatan.trim() !== '')
      case 'quran-hafalan':
        return logs.filter((l) => l.source === 'pengajian')
      default:
        return []
    }
  }, [logs, picked])

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {trackers.map((t) => (
          <TrackerCard
            key={t.key}
            icon={t.icon}
            title={t.title}
            done={t.done}
            total={t.total}
            unit={t.unit}
            hint={(t as { hint?: string }).hint}
            onClick={() => setPicked({ key: t.key, title: t.title })}
          />
        ))}
      </div>
      {picked ? (
        <TrackerDetailDialog
          title={picked.title}
          logs={pickedLogs}
          onClose={() => setPicked(null)}
        />
      ) : null}
    </>
  )
}

// Group logs by surah → { surah, ayatRead = max(ayatTo), sessions, source }
// and split into 'in progress' (ayatRead < total) vs 'completed' (≥).
type SurahAgg = { surah: number; ayatRead: number; sessions: number }

function aggregateBySurah(
  logs: { surah: number; ayatFrom: number; ayatTo: number }[],
): SurahAgg[] {
  const map = new Map<number, SurahAgg>()
  for (const l of logs) {
    const cur = map.get(l.surah) ?? { surah: l.surah, ayatRead: 0, sessions: 0 }
    cur.ayatRead = Math.max(cur.ayatRead, l.ayatTo || l.ayatFrom)
    cur.sessions += 1
    map.set(l.surah, cur)
  }
  return [...map.values()].sort((a, b) => a.surah - b.surah)
}

function TrackerDetailDialog({
  title,
  logs,
  onClose,
}: {
  title: string
  logs: { id: string; surah: number; ayatFrom: number; ayatTo: number; tanggal: string; source: string; catatan?: string | null }[]
  onClose: () => void
}) {
  const { data: surahs = [] } = useQuery({
    queryKey: ['quran-surahs'],
    queryFn: () => import('@/api/quran').then((m) => m.listQuranSurahs()),
    staleTime: 60 * 60_000,
  })
  const surahById = useMemo(() => new Map(surahs.map((s) => [s.id, s])), [surahs])

  const aggs = useMemo(() => aggregateBySurah(logs), [logs])
  // Split into in-progress (not yet covering full surah) vs completed.
  const inProgress: SurahAgg[] = []
  const completed: SurahAgg[] = []
  for (const a of aggs) {
    const total = surahById.get(a.surah)?.jumlahAyat ?? a.ayatRead
    if (total > 0 && a.ayatRead >= total) completed.push(a)
    else inProgress.push(a)
  }

  return (
    <Dialog title={title} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="text-xs text-slate-500">
          {logs.length} catatan · {inProgress.length} sedang progress ·{' '}
          {completed.length} selesai
        </div>

        {/* Donut strip — sedang progress + selesai. Mirrors the
            BacaanProgressPanel layout, scrollable horizontally. */}
        {(inProgress.length > 0 || completed.length > 0) ? (
          <>
            {inProgress.length > 0 ? (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  Sedang progress ({inProgress.length})
                </div>
                <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                  {inProgress.map((a) => (
                    <SurahDonutMini
                      key={a.surah}
                      agg={a}
                      total={surahById.get(a.surah)?.jumlahAyat ?? a.ayatRead}
                      label={surahById.get(a.surah)?.nama}
                      color="amber"
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {completed.length > 0 ? (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                  Selesai ({completed.length})
                </div>
                <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                  {completed.map((a) => (
                    <SurahDonutMini
                      key={a.surah}
                      agg={a}
                      total={surahById.get(a.surah)?.jumlahAyat ?? a.ayatRead}
                      label={surahById.get(a.surah)?.nama}
                      color="emerald"
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <p className="rounded-md bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
            Belum ada progress untuk aspek ini di rentang waktu yang dipilih.
          </p>
        )}

        {/* Riwayat catatan */}
        {logs.length > 0 ? (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Riwayat catatan
            </div>
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {logs.map((l) => (
                <li key={l.id} className="flex items-start gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      Surah {l.surah} · ayat {l.ayatFrom}
                      {l.ayatTo !== l.ayatFrom ? `–${l.ayatTo}` : ''}
                      <span
                        className={
                          'rounded-full px-2 py-0.5 text-[10px] font-medium ' +
                          (l.source === 'pengajian'
                            ? 'bg-violet-100 text-violet-700'
                            : 'bg-slate-100 text-slate-600')
                        }
                      >
                        {l.source}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">{l.tanggal}</div>
                    {l.catatan ? (
                      <div className="mt-0.5 text-xs text-slate-600">{l.catatan}</div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

function SurahDonutMini({
  agg,
  total,
  label,
  color,
}: {
  agg: SurahAgg
  total: number
  label?: string
  color: 'emerald' | 'amber'
}) {
  const pct = total > 0 ? Math.min(100, Math.round((agg.ayatRead / total) * 100)) : 0
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const filled = Math.max(0, Math.min(100, pct)) / 100
  const ringColor = color === 'amber' ? '#f59e0b' : '#059669'
  const trackColor = color === 'amber' ? '#fef3c7' : '#d1fae5'
  const labelColor = color === 'amber' ? 'text-amber-900' : 'text-emerald-900'
  return (
    <div className="flex w-20 flex-shrink-0 flex-col items-center text-center">
      <div className="relative h-16 w-16">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={radius} fill="none" stroke={trackColor} strokeWidth="14" />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth="14"
            strokeDasharray={`${filled * circumference} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>
        <div className={'absolute inset-0 flex items-center justify-center text-xs font-bold ' + labelColor}>
          {pct}%
        </div>
      </div>
      <div className="mt-1 line-clamp-2 text-[10px] font-medium text-slate-800">
        {agg.surah}. {label ?? `Surah ${agg.surah}`}
      </div>
      <div className="text-[10px] text-slate-500">
        {agg.ayatRead}/{total}
      </div>
    </div>
  )
}

function TrackerCard({
  icon,
  title,
  done,
  total,
  unit,
  hint,
  onClick,
}: {
  icon: string
  title: string
  done: number
  total: number
  unit: string
  hint?: string
  onClick?: () => void
}) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow disabled:cursor-default disabled:hover:border-slate-200 disabled:hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-lg">{icon}</span>
            <div className="text-sm font-semibold text-slate-800">{title}</div>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {done.toLocaleString('id-ID')} / {total.toLocaleString('id-ID')} {unit}
          </div>
        </div>
        <div className="flex flex-col items-center">
          <TinyDonut pct={pct} />
          {/* Persentase penambahan materi — kecil simpel beside the pie. */}
          <span className="mt-1 text-[10px] font-medium text-emerald-700">+{pct}%</span>
        </div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      {hint ? <p className="mt-2 text-[10px] text-slate-400">{hint}</p> : null}
    </button>
  )
}

function TinyDonut({ pct }: { pct: number }) {
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const filled = Math.max(0, Math.min(100, pct)) / 100
  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#d1fae5" strokeWidth="14" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="#059669"
          strokeWidth="14"
          strokeDasharray={`${filled * circumference} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-emerald-900">
        {pct}%
      </div>
    </div>
  )
}
