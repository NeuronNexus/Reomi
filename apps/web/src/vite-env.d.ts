/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_SUPABASE_URL: string;
  /** The Supabase publishable (anon) key. Safe in the browser only because all tables deny it. */
  readonly VITE_SUPABASE_KEY: string;
}
