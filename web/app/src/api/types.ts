export type Role = 'admin' | 'staff'

export type User = {
  id: string
  email: string
  username?: string
  name: string
  role: Role
  createdAt: string
  updatedAt: string
  // Optional profile fields exposed by the backend on /api/auth/me.
  nickname?: string | null
  timezone?: string | null
  noHp?: string | null
  alamat?: string | null
  photoUrl?: string | null
}

// AuthMe is the server response shape for /api/auth/login and /api/auth/me.
// It extends User with the API base for the current session (either the
// canonical "/api" or a dynamic per-session prefix like "/a3f8d2").
export type AuthMe = User & {
  apiBase: string
}

export const SORT_COLUMNS = ['name', 'created_at'] as const
export type SortColumn = (typeof SORT_COLUMNS)[number]
export type SortDir = 'asc' | 'desc'
export type Gender = 'male' | 'female'

export const STUDENT_LEVELS = ['Caberawit', 'Pra Remaja', 'Remaja', 'Pra Nikah'] as const
export type StudentLevel = (typeof STUDENT_LEVELS)[number]

export const STUDENT_KELOMPOKS = ['California', 'Chicago', 'New Hampshire', 'Canada'] as const
export type StudentKelompok = (typeof STUDENT_KELOMPOKS)[number]

export type StudentStatus = 'active' | 'left'

export type Student = {
  id: string
  name: string
  nickname?: string
  dateOfBirth?: string
  gender: 'male' | 'female'
  level?: StudentLevel
  kelompok?: StudentKelompok
  joinedAt?: string
  leftAt?: string
  leaveReason?: string
  status: StudentStatus
  parentName?: string
  parentTitle?: string
  parentPhone?: string
  parentPhoneRegion?: 'ID' | 'SG' | 'US' | 'CA'
  parentEmail?: string
  photoUrl?: string
  createdAt: string
  updatedAt: string
}

export type StudentList = {
  items: Student[]
  total: number
}

export type StudentInput = {
  name: string
  nickname?: string
  dateOfBirth?: string
  gender: 'male' | 'female'
  level?: StudentLevel
  kelompok?: StudentKelompok
  joinedAt?: string
  leftAt?: string
  leaveReason?: string
  status: StudentStatus
  parentName?: string
  parentTitle?: string
  parentPhone?: string
  parentPhoneRegion?: 'ID' | 'SG' | 'US' | 'CA'
  parentEmail?: string
}

export type TeacherStatus = 'active' | 'retired'

export type Teacher = {
  id: string
  name: string
  nickname?: string
  gender?: 'male' | 'female'
  kelompok: string
  desa: string
  daerah: string
  joinedAt?: string
  retiredAt?: string
  status: TeacherStatus
  notes?: string
  photoUrl?: string
  createdAt: string
  updatedAt: string
}

export type TeacherList = {
  items: Teacher[]
  total: number
}

export type TeacherInput = {
  name: string
  nickname?: string
  gender?: 'male' | 'female'
  kelompok: string
  desa: string
  daerah: string
  joinedAt?: string
  retiredAt?: string
  status: TeacherStatus
  notes?: string
}
