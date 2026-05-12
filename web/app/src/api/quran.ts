import { apiFetch } from './client'

export type QuranSurah = {
  id: number
  nama: string
  namaArab: string
  namaTerjemahan?: { name?: string; language_name?: string } | null
  jumlahAyat: number
  revelationPlace?: string
  /** Mushaf page range: [startPage, endPage]. */
  paginasi?: [number, number]
}

export type QuranWord = {
  arab: string
  terjemahan?: string
  transliterasi?: string
}

export type QuranTranslationText = {
  id: number
  teks: string
}

export type QuranAyah = {
  id?: number
  kunciAyat: string
  halaman?: number
  juz?: number
  arab: string
  terjemahan: string | QuranTranslationText[]
  perKata: QuranWord[]
}

export type QuranPageResponse = {
  halaman: number
  ayat: QuranAyah[]
}

export type QuranVerse = {
  id: number
  verseKey: string
  verseNumber: number
  textUthmani: string
  translation: string
}

export type QuranSurahDetail = {
  chapter: {
    id: number
    name_simple: string
    name_arabic: string
    translated_name?: { name?: string }
    verses_count: number
    revelation_place?: string
  }
  verses: QuranVerse[]
}

export type QuranTranslation = {
  id: number
  code: string
  label: string
  lang: string
}

export type ManqulNote = {
  id: string
  userId: string
  kunciAyat: string
  wordIdx: number
  teks: string
  createdAt: string
  updatedAt: string
}

export function listQuranSurahs() {
  return apiFetch<QuranSurah[]>('/api/quran/surahs')
}

export function getQuranSurah(id: number | string, translation?: string) {
  const qs = translation ? `?translation=${encodeURIComponent(translation)}` : ''
  return apiFetch<QuranSurahDetail>(`/api/quran/surahs/${id}${qs}`)
}

export function listQuranTranslations() {
  return apiFetch<QuranTranslation[]>('/api/quran/translations')
}

export function getQuranPage(
  n: number,
  opts: { translations?: string; words?: boolean; wordTrans?: string } = {},
) {
  const sp = new URLSearchParams()
  if (opts.translations) sp.set('translations', opts.translations)
  if (opts.words) sp.set('words', 'true')
  if (opts.wordTrans) sp.set('wordTrans', opts.wordTrans)
  const qs = sp.toString()
  return apiFetch<QuranPageResponse>(`/api/quran/pages/${n}${qs ? `?${qs}` : ''}`)
}

export function listManqulNotes(surah?: string) {
  const qs = surah ? `?surah=${encodeURIComponent(surah)}` : ''
  return apiFetch<ManqulNote[]>(`/api/quran/manqul-notes${qs}`)
}

export function upsertManqulNote(input: { kunciAyat: string; wordIdx: number; teks: string }) {
  return apiFetch<ManqulNote | { deleted: true }>('/api/quran/manqul-notes', {
    method: 'POST',
    body: input,
  })
}
