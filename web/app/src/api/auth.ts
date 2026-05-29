import { apiFetch, setApiBase } from '@/lib/api'
import type { AuthMe, User } from './types'

// login authenticates the user and pushes the server's apiBase into the
// shared module state so subsequent calls use the dynamic prefix.
export function login(identifier: string, password: string): Promise<AuthMe> {
  return apiFetch<AuthMe>('/api/auth/login', {
    method: 'POST',
    body: { identifier, password },
  }).then((res) => {
    setApiBase(res.apiBase)
    return res
  })
}

export function logout() {
  return apiFetch<void>('/api/auth/logout', { method: 'POST' })
}

// me returns the current user and refreshes the shared apiBase so a reloaded
// SPA recovers the dynamic prefix even when the meta-tag injection was missed.
export function me(): Promise<AuthMe> {
  return apiFetch<AuthMe>('/api/auth/me').then((res) => {
    setApiBase(res.apiBase)
    return res
  })
}

export type UpdateMeInput = {
  name?: string
  nickname?: string | null
  timezone?: string | null
  noHp?: string | null
  alamat?: string | null
  tempatLahir?: string | null
  pendidikan?: string | null
  pekerjaan?: string | null
  gender?: 'male' | 'female' | null
  hideDob?: boolean
  dateOfBirth?: string | null
}

export function updateMe(input: UpdateMeInput) {
  return apiFetch<User>('/api/auth/me', { method: 'PATCH', body: input })
}

export function setMyPassword(password: string) {
  return apiFetch<void>('/api/auth/me/password', { method: 'POST', body: { password } })
}

export async function uploadMyPhoto(file: File): Promise<User> {
  const fd = new FormData()
  fd.append('file', file)
  return apiFetch<User>('/api/auth/me/photo', { method: 'POST', body: fd })
}

export function deleteMyPhoto() {
  return apiFetch<User>('/api/auth/me/photo', { method: 'DELETE' })
}
