import { NavLink, Outlet } from 'react-router-dom'
import { Building2, CalendarRange, GraduationCap, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'

export function SettingsLayout() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-shrink-0 space-y-4 px-4 pt-5 md:px-6 md:pt-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pengaturan</p>
          <h1 className="mt-1 text-2xl font-semibold">Konfigurasi GNRS US</h1>
          <p className="mt-1 text-sm text-slate-500">
            Kelola akun, role, dan kurikulum dari satu tempat.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-200">
          <TabLink to="/pengaturan/instansi" icon={<Building2 size={16} />} label="Instansi" />
          <TabLink to="/pengaturan/pengguna" icon={<ShieldCheck size={16} />} label="Pengguna" />
          <TabLink to="/pengaturan/kurikulum" icon={<GraduationCap size={16} />} label="Kurikulum" />
          <TabLink
            to="/pengaturan/tahun-ajaran"
            icon={<CalendarRange size={16} />}
            label="Tahun Ajaran"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}

function TabLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-t-md px-4 py-2 text-sm font-medium transition',
          '-mb-px border-b-2',
          isActive
            ? 'border-slate-900 text-slate-900'
            : 'border-transparent text-slate-500 hover:text-slate-700',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}
