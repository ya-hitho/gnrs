import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Clock, Sparkles, Users } from 'lucide-react'
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  ATTENDANCE_STATUS_LABEL,
  getAttendanceStats,
  type AttendanceStatus,
} from '@/api/attendances'
import { PageShell, PageHeader } from '@/components/PageShell'
import { cn } from '@/lib/cn'

/**
 * Kehadiran — analytics page that matches the design from the reference
 * screenshot: filter chips → 4 KPIs → monthly line + status donut → per
 * generus + per pengajar tables. All aggregates come from /api/attendances/stats.
 */

type RangePreset = 'all' | 'thisYear' | 'thisMonth' | number

const STATUS_COLOR: Record<AttendanceStatus, string> = {
  hadir: '#10b981',
  izin_murid: '#3b82f6',
  izin_guru: '#f97316',
  by_vn: '#0ea5e9',
}

export function KehadiranPage() {
  const today = new Date()
  const [preset, setPreset] = useState<RangePreset>('all')

  const { dateFrom, dateTo, label } = useMemo(() => {
    if (preset === 'all') return { dateFrom: undefined, dateTo: undefined, label: 'Semua tahun' }
    if (preset === 'thisYear') {
      const y = today.getFullYear()
      return { dateFrom: `${y}-01-01`, dateTo: `${y}-12-31`, label: String(y) }
    }
    if (preset === 'thisMonth') {
      const y = today.getFullYear()
      const m = String(today.getMonth() + 1).padStart(2, '0')
      const last = new Date(y, today.getMonth() + 1, 0).getDate()
      return {
        dateFrom: `${y}-${m}-01`,
        dateTo: `${y}-${m}-${String(last).padStart(2, '0')}`,
        label: `${y}-${m}`,
      }
    }
    return {
      dateFrom: `${preset}-01-01`,
      dateTo: `${preset}-12-31`,
      label: String(preset),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  const { data: stats } = useQuery({
    queryKey: ['attendance-stats', dateFrom, dateTo],
    queryFn: () => getAttendanceStats({ dateFrom, dateTo }),
  })

  const years = useMemo(() => {
    const set = new Set<number>(stats?.availableYears ?? [])
    const cur = today.getFullYear()
    set.add(cur)
    set.add(cur - 1)
    set.add(cur - 2)
    return Array.from(set).sort((a, b) => b - a)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats?.availableYears])

  return (
    <PageShell
      header={
        <PageHeader
          eyebrow="Kehadiran"
          title="Kehadiran"
          subtitle="Ringkasan dan analitik dari seluruh data Pengajian."
        />
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            RENTANG WAKTU
          </span>
          <FilterChip active={preset === 'all'} onClick={() => setPreset('all')}>
            Semua
          </FilterChip>
          <FilterChip active={preset === 'thisYear'} onClick={() => setPreset('thisYear')}>
            Tahun Ini
          </FilterChip>
          <FilterChip active={preset === 'thisMonth'} onClick={() => setPreset('thisMonth')}>
            Bulan Ini
          </FilterChip>
          {years.map((y) => (
            <FilterChip key={y} active={preset === y} onClick={() => setPreset(y)}>
              {y}
            </FilterChip>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            icon={<CalendarDays size={18} />}
            label="Total Sesi"
            value={fmt(stats?.total.sessions ?? 0)}
            sub={label}
          />
          <KpiCard
            icon={<Clock size={18} />}
            label="Total Jam Ngaji"
            value={`${Math.round(stats?.total.hours ?? 0).toLocaleString('id-ID')} jam`}
            sub={label}
          />
          <KpiCard
            icon={<Sparkles size={18} />}
            label="Sesi 30 Hari Terakhir"
            value={fmt(stats?.total.last30Days ?? 0)}
            sub="Tidak terpengaruh filter"
          />
          <KpiCard
            icon={<Users size={18} />}
            label="Pasangan Aktif (30hr)"
            value={fmt(stats?.total.activePairs ?? 0)}
            sub="Generus × Pengajar"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
            <div className="mb-2 text-sm font-semibold text-slate-800">Sesi per Bulan</div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={stats?.monthly ?? []}
                  margin={{ top: 5, right: 12, bottom: 5, left: 0 }}
                >
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} />
                  <Tooltip
                    cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                    contentStyle={{ borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="sessions"
                    stroke="#0f172a"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 text-sm font-semibold text-slate-800">Distribusi Status</div>
            <StatusDonut buckets={stats?.byStatus ?? []} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">
              Per Generus
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nama</th>
                    <th className="px-3 py-2 text-right">Sesi ▼</th>
                    <th className="px-3 py-2 text-right">% Hadir</th>
                    <th className="px-3 py-2 text-right">Jam</th>
                    <th className="px-3 py-2 text-right">Sesi Terakhir</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(stats?.byStudent ?? []).slice(0, 30).map((s) => (
                    <tr key={s.studentId} className="hover:bg-slate-50">
                      <td className="truncate px-3 py-2 font-medium text-slate-900">{s.studentName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.totalSessions}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Math.round(s.hadirRate)}%</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.totalHours.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-500">
                        {s.lastDate?.slice(0, 10) ?? '—'}
                      </td>
                    </tr>
                  ))}
                  {(stats?.byStudent ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-500">
                        Belum ada data.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">
              Per Pengajar
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nama</th>
                    <th className="px-3 py-2 text-right">Sesi ▼</th>
                    <th className="px-3 py-2 text-right">Jam</th>
                    <th className="px-3 py-2 text-right"># Generus</th>
                    <th className="px-3 py-2 text-right">Sesi Terakhir</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(stats?.byTeacher ?? []).slice(0, 30).map((t) => (
                    <tr key={t.teacherId} className="hover:bg-slate-50">
                      <td className="truncate px-3 py-2 font-medium text-slate-900">{t.teacherName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.totalSessions}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.totalHours.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.uniqueStudents}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-500">
                        {t.lastDate?.slice(0, 10) ?? '—'}
                      </td>
                    </tr>
                  ))}
                  {(stats?.byTeacher ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-500">
                        Belum ada data.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  )
}

function FilterChip({
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
        'rounded-full border px-3 py-1 text-xs font-medium transition',
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100',
      )}
    >
      {children}
    </button>
  )
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-600">
        <span className="rounded-md bg-slate-100 p-1.5">{icon}</span>
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  )
}

function StatusDonut({ buckets }: { buckets: { label: string; count: number }[] }) {
  const data = buckets
    .filter((b) => b.count > 0)
    .map((b) => ({
      name: ATTENDANCE_STATUS_LABEL[b.label as AttendanceStatus] ?? b.label,
      key: b.label,
      value: b.count,
    }))
  const total = data.reduce((a, b) => a + b.value, 0)
  if (total === 0) {
    return <p className="py-12 text-center text-xs text-slate-500">Belum ada data pada rentang ini.</p>
  }
  return (
    <div className="flex items-center gap-4">
      <div className="h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={2}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.key} fill={STATUS_COLOR[d.key as AttendanceStatus] ?? '#94a3b8'} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number) => `${v} (${Math.round((v / total) * 100)}%)`}
              contentStyle={{ borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="grid flex-1 grid-cols-1 gap-y-1.5 text-xs">
        {(['hadir', 'izin_murid', 'izin_guru', 'by_vn'] as AttendanceStatus[]).map((s) => {
          const b = buckets.find((x) => x.label === s)
          return (
            <li key={s} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: STATUS_COLOR[s] }}
              />
              <span className="flex-1 text-slate-700">{ATTENDANCE_STATUS_LABEL[s]}</span>
              <span className="tabular-nums font-medium text-slate-900">{b?.count ?? 0}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function fmt(n: number): string {
  return n.toLocaleString('id-ID')
}
