
-- Remove leftover public INSERT policy on quotations storage bucket
DROP POLICY IF EXISTS "Public upload quotations" ON storage.objects;

-- Tighten orders RLS: replace USING (true) with auth.uid() IS NOT NULL
DROP POLICY IF EXISTS "Authenticated can view orders" ON public.orders;
DROP POLICY IF EXISTS "Authenticated can insert orders" ON public.orders;
DROP POLICY IF EXISTS "Authenticated can update orders" ON public.orders;
DROP POLICY IF EXISTS "Authenticated can delete orders" ON public.orders;

CREATE POLICY "Authenticated can view orders" ON public.orders
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can insert orders" ON public.orders
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can update orders" ON public.orders
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can delete orders" ON public.orders
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- Same tightening for price_list
DROP POLICY IF EXISTS "Authenticated can view price_list" ON public.price_list;
DROP POLICY IF EXISTS "Authenticated can insert price_list" ON public.price_list;
DROP POLICY IF EXISTS "Authenticated can update price_list" ON public.price_list;
DROP POLICY IF EXISTS "Authenticated can delete price_list" ON public.price_list;

CREATE POLICY "Authenticated can view price_list" ON public.price_list
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can insert price_list" ON public.price_list
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can update price_list" ON public.price_list
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can delete price_list" ON public.price_list
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- Same for order_audit_logs
DROP POLICY IF EXISTS "Authenticated can view audit logs" ON public.order_audit_logs;
DROP POLICY IF EXISTS "Authenticated can insert audit logs" ON public.order_audit_logs;

CREATE POLICY "Authenticated can view audit logs" ON public.order_audit_logs
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can insert audit logs" ON public.order_audit_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL AND actor_id = auth.uid());
