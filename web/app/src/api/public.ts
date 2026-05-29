import { apiFetch } from './client'
import type { Attendance } from './attendances'

// Public form status set excludes 'alfa' (no-show is a staff judgment,
// not self-reported). Mirrors the server's oneof validation.
export type PublicAttendanceStatus = 'hadir' | 'izin_murid' | 'izin_guru' | 'by_vn'

export type PublicOption = {
  id: string
  name: string
  nickname?: string
}

export type PublicOptionList = {
  items: PublicOption[]
}

export type PublicAttendanceInput = {
  date: string
  durationMin?: number
  teacherId: string
  studentId: string
  status: PublicAttendanceStatus
  materi?: string
  submittedPhone: string
}

export function listPublicTeachers() {
  return apiFetch<PublicOptionList>('/api/public/teachers')
}

export function listPublicStudents() {
  return apiFetch<PublicOptionList>('/api/public/students')
}

// PublicAttendanceResponse flattens the created Attendance and adds the
// pre-built wa.me click-to-chat URL targeted at the submitted phone. The
// /absen page navigates to it after a successful POST so WhatsApp opens with
// the formatted report pre-filled. Empty only on the unreachable path where
// the server could not build a URL (submittedPhone is required + validated).
export type PublicAttendanceResponse = Attendance & {
  waMeUrl: string
}

export function submitPublicAttendance(input: PublicAttendanceInput) {
  return apiFetch<PublicAttendanceResponse>('/api/public/attendances', {
    method: 'POST',
    body: input,
  })
}
