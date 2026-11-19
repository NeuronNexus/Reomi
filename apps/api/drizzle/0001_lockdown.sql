-- Profiles belong to Supabase Auth users. The database can also be a plain Postgres (Render),
-- in which case there is no auth schema and identity is checked only through signed tokens.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users'
  ) THEN
    ALTER TABLE "profiles"
      ADD CONSTRAINT "profiles_id_auth_users_fk"
      FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint

-- Supabase publishes the public schema through PostgREST, and the anon key ships in the browser.
-- This app reads data only through the API, so nothing here may be reachable that way: real names
-- and emails sit next to anonymous aliases. RLS with no policies denies every row, and the grants
-- are removed as well so a table added later cannot be exposed by a single forgotten statement.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  END IF;
END $$;
