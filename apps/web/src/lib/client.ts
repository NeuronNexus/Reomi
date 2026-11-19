import { createClient } from '@supabase/supabase-js';
import { createApiClient } from '@agnipath/shared';

const required = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`${name} is not set. See apps/web/.env.example.`);
  return value;
};

export const supabase = createClient(
  required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
  required('VITE_SUPABASE_KEY', import.meta.env.VITE_SUPABASE_KEY),
);

export const api = createApiClient(
  required('VITE_API_URL', import.meta.env.VITE_API_URL),
  async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
);
