import { useQuery } from '@tanstack/react-query'

import { listDoa } from '@/api/doa'
import { listKitab } from '@/api/hadits'
import { listQuranSurahs } from '@/api/quran'
import type { LibraryAspect, LibraryKind } from '@/api/sesi'

const KIND_LABEL: Record<LibraryKind, string> = {
  kurikulum: 'Kurikulum',
  quran: "Al-Qur'an",
  hadits: 'Hadits',
  tilawati: 'Tilawati',
  doa: 'Doa',
}

const ASPECT_LABEL: Record<LibraryAspect, string> = {
  reciting: 'Membaca',
  memorizing: 'Menghafal',
  review: 'Mengulang',
  manqul: 'Manqul',
}

/**
 * formatQuranRef — turns the canonical Quran library_ref into a human label.
 * Accepts "<surah>" | "<surah>:<ayat>" | "<surah>:<from>-<to>". Returns
 * "<Nama Surat> (<n>) : <ayat>" or just "<Nama Surat> (<n>)" for whole surah.
 */
function formatQuranRef(ref: string, surahNameById: Record<number, string>): string {
  const parts = ref.split(':')
  const surahNum = Number(parts[0])
  if (!surahNum || surahNum < 1 || surahNum > 114) return ref
  const nama = surahNameById[surahNum] || `Surat ${surahNum}`
  const base = `${nama} (${surahNum})`
  if (parts.length < 2 || !parts[1]) return base
  return `${base} : ${parts[1]}`
}

/** formatHaditsRef — "<slug>" or "<slug>#<n>" / "<slug>#<a>-<b>". */
function formatHaditsRef(ref: string, kitabNameBySlug: Record<string, string>): string {
  const i = ref.indexOf('#')
  const slug = i >= 0 ? ref.slice(0, i) : ref
  const nomor = i >= 0 ? ref.slice(i + 1) : ''
  const nama = kitabNameBySlug[slug] || slug
  return nomor ? `${nama} · No. ${nomor}` : nama
}

/** formatTilawatiRef — "<jilid>" or "<jilid>:<page>" / "<jilid>:<a>-<b>". */
function formatTilawatiRef(ref: string): string {
  const parts = ref.split(':')
  const jilid = parts[0]
  const page = parts[1]
  if (!page) return `Jilid ${jilid}`
  return `Jilid ${jilid} · Hal. ${page}`
}

/** Resolve doa ref (compact_ajar.id) → doa.nama. Falls back to raw id. */
function formatDoaRef(ref: string, doaNameById: Record<string, string>): string {
  return doaNameById[ref] || ref
}

/**
 * LibraryRefLabel — small read-only display that converts a raw
 * (libraryKind, libraryRef, libraryAspect) tuple into a human-friendly
 * label. Caches the lookup tables behind react-query so callers don't
 * trigger N fetches when many items are rendered.
 */
export function LibraryRefLabel({
  libraryKind,
  libraryRef,
  libraryAspect,
  className,
  showKind = true,
}: {
  libraryKind: LibraryKind
  libraryRef?: string | null
  libraryAspect?: LibraryAspect | null
  className?: string
  showKind?: boolean
}) {
  const ref = libraryRef ?? ''

  const needsSurahs = libraryKind === 'quran'
  const needsKitabs = libraryKind === 'hadits'
  const needsDoa = libraryKind === 'doa'

  const { data: surahs } = useQuery({
    queryKey: ['quran-surahs'],
    queryFn: listQuranSurahs,
    staleTime: 60 * 60_000,
    enabled: needsSurahs,
  })

  const { data: kitabs } = useQuery({
    queryKey: ['hadits-kitab', 'hadits'],
    queryFn: () => listKitab('hadits'),
    staleTime: 60 * 60_000,
    enabled: needsKitabs,
  })

  const { data: doas } = useQuery({
    queryKey: ['doa-list'],
    queryFn: () => listDoa({}),
    staleTime: 60 * 60_000,
    enabled: needsDoa,
  })

  let label = ref
  if (!ref) {
    label = '—'
  } else if (libraryKind === 'quran') {
    const map: Record<number, string> = {}
    for (const s of surahs ?? []) map[s.id] = s.nama
    label = formatQuranRef(ref, map)
  } else if (libraryKind === 'hadits') {
    const map: Record<string, string> = {}
    for (const k of kitabs ?? []) map[k.slug] = k.nama
    label = formatHaditsRef(ref, map)
  } else if (libraryKind === 'tilawati') {
    label = formatTilawatiRef(ref)
  } else if (libraryKind === 'doa') {
    const map: Record<string, string> = {}
    for (const d of doas ?? []) map[d.id] = d.nama
    label = formatDoaRef(ref, map)
  }

  return (
    <span className={className}>
      {showKind ? (
        <span className="text-xs uppercase tracking-wide text-sky-700">
          {KIND_LABEL[libraryKind]}
          {libraryAspect ? ` · ${ASPECT_LABEL[libraryAspect]}` : ''}
        </span>
      ) : null}
      <span className="block text-sm">{label}</span>
    </span>
  )
}
