-- Drop the signup gate trigger (correct name) and function with cascade
DROP TRIGGER IF EXISTS trg_enforce_allowed_email ON auth.users;
DROP FUNCTION IF EXISTS public.enforce_allowed_email() CASCADE;

-- Replace RLS policies on orders: allow any authenticated user
DROP POLICY IF EXISTS "Team can view orders" ON public.orders;
DROP POLICY IF EXISTS "Team can insert orders" ON public.orders;
DROP POLICY IF EXISTS "Team can update orders" ON public.orders;
DROP POLICY IF EXISTS "Team can delete orders" ON public.orders;

CREATE POLICY "Authenticated can view orders"
  ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert orders"
  ON public.orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update orders"
  ON public.orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete orders"
  ON public.orders FOR DELETE TO authenticated USING (true);

-- Replace RLS policies on price_list
DROP POLICY IF EXISTS "Team can view price_list" ON public.price_list;
DROP POLICY IF EXISTS "Team can insert price_list" ON public.price_list;
DROP POLICY IF EXISTS "Team can update price_list" ON public.price_list;
DROP POLICY IF EXISTS "Team can delete price_list" ON public.price_list;

CREATE POLICY "Authenticated can view price_list"
  ON public.price_list FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert price_list"
  ON public.price_list FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update price_list"
  ON public.price_list FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete price_list"
  ON public.price_list FOR DELETE TO authenticated USING (true);

-- Replace storage policies on quotations bucket
DROP POLICY IF EXISTS "Team can read quotations" ON storage.objects;
DROP POLICY IF EXISTS "Team can upload quotations" ON storage.objects;
DROP POLICY IF EXISTS "Team can update quotations" ON storage.objects;
DROP POLICY IF EXISTS "Team can delete quotations" ON storage.objects;

CREATE POLICY "Authenticated can read quotations"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'quotations');
CREATE POLICY "Authenticated can upload quotations"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'quotations');
CREATE POLICY "Authenticated can update quotations"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'quotations') WITH CHECK (bucket_id = 'quotations');
CREATE POLICY "Authenticated can delete quotations"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'quotations');

-- Drop the team-member helper and allow-list table
DROP FUNCTION IF EXISTS public.is_team_member() CASCADE;
DROP TABLE IF EXISTS public.allowed_emails;