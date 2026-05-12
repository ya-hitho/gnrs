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
  parentPhone?: string
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
  parentPhone?: string
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
