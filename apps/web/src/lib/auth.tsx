import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, use, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiRequestError } from '@agnipath/shared';
import type { Me } from '@agnipath/shared';
import { api, supabase } from './client';

interface AuthState {
  /** False until the stored session has been read, so guards do not redirect too early. */
  ready: boolean;
  session: Session | null;
  me: Me | null;
  suspended: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const me = useQuery({
    queryKey: ['me', userId],
    queryFn: () => api.get<Me>('/v1/me'),
    enabled: Boolean(userId),
    retry: false,
  });

  const value = useMemo<AuthState>(() => {
    const suspended = me.error instanceof ApiRequestError && me.error.code === 'account_suspended';
    return {
      ready: session !== undefined && (!userId || !me.isPending),
      session: session ?? null,
      me: me.data ?? null,
      suspended,
      signOut: async () => {
        await supabase.auth.signOut();
        queryClient.clear();
      },
    };
  }, [session, userId, me.data, me.error, me.isPending, queryClient]);

  return <AuthContext value={value}>{children}</AuthContext>;
};

export const useAuth = (): AuthState => {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
};
