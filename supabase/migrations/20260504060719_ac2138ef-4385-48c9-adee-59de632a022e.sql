CREATE TABLE IF NOT EXISTS public.order_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid,
  actor_name text,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_audit_logs_order_id ON public.order_audit_logs(order_id);

ALTER TABLE public.order_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view audit logs"
  ON public.order_audit_logs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert audit logs"
  ON public.order_audit_logs FOR INSERT TO authenticated WITH CHECK (true);