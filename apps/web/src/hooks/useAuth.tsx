import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setToken, getToken } from '../lib/api';
import type { Me } from '../lib/types';

interface Ctx {
  me: Me | null; loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}
const AuthContext = createContext<Ctx>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api.get<Me>('/auth/me')
      .then(setMe)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ token: string; user: Me }>('/auth/login', { email, password });
    setToken(r.token);
    setMe(r.user);
  }, []);

  const signOut = useCallback(() => { setToken(null); setMe(null); }, []);

  return <AuthContext.Provider value={{ me, loading, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/* Small helper so pages can ask "may this person do X?" in one place. */
export function useCan() {
  const { me } = useAuth();
  const role = me?.role;
  return {
    role,
    isOh: role === 'OH_OFFICER',
    canPlan: role === 'ROSTER_PLANNER' || role === 'HR_ADMIN' || role === 'SYSTEM_ADMIN',
    canApprove: ['ROSTER_PLANNER', 'HR_ADMIN', 'LINE_MANAGER', 'SYSTEM_ADMIN'].includes(role ?? ''),
    canSeeDirectory: ['LINE_MANAGER', 'ROSTER_PLANNER', 'HR_ADMIN', 'OH_OFFICER', 'SYSTEM_ADMIN', 'COMPLIANCE_AUDITOR'].includes(role ?? ''),
    canSeePay: ['HR_ADMIN', 'SYSTEM_ADMIN', 'COMPLIANCE_AUDITOR'].includes(role ?? ''),
    canAudit: ['COMPLIANCE_AUDITOR', 'HR_ADMIN', 'SYSTEM_ADMIN', 'OH_OFFICER'].includes(role ?? ''),
    isEmployee: !!me?.employeeId,
  };
}
