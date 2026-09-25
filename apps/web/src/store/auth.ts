'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  tenantId: string | null;
  avatarUrl?: string | null;
  /**
   * E-mail confirmado. Vem do login e do cadastro; `GET /users/me` o atualiza a
   * cada carga do painel, porque o valor guardado aqui envelhece assim que a
   * pessoa clica no link do e-mail em outra aba.
   */
  emailVerified?: boolean;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setSession: (token: string, user: AuthUser) => void;
  updateUser: (partial: Partial<AuthUser>) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      updateUser: (partial) =>
        set((state) => ({ user: state.user ? { ...state.user, ...partial } : null })),
      clear: () => set({ token: null, user: null }),
    }),
    { name: 'autoconnect-auth' },
  ),
);
