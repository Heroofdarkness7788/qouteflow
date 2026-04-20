-- Price list table
CREATE TABLE public.price_list (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'pcs',
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_list_sku ON public.price_list(sku);

ALTER TABLE public.price_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read price_list" ON public.price_list FOR SELECT USING (true);
CREATE POLICY "Public insert price_list" ON public.price_list FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update price_list" ON public.price_list FOR UPDATE USING (true);
CREATE POLICY "Public delete price_list" ON public.price_list FOR DELETE USING (true);

-- Orders / quotations tracking table
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quotation_number TEXT NOT NULL UNIQUE,
  customer_name TEXT,
  customer_email TEXT,
  email_subject TEXT,
  email_body TEXT,
  attachment_names TEXT[],
  extracted_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  matched_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  unmatched_skus TEXT[] DEFAULT ARRAY[]::TEXT[],
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  quotation_file_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_created_at ON public.orders(created_at DESC);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read orders" ON public.orders FOR SELECT USING (true);
CREATE POLICY "Public insert orders" ON public.orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update orders" ON public.orders FOR UPDATE USING (true);
CREATE POLICY "Public delete orders" ON public.orders FOR DELETE USING (true);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_price_list_updated_at
  BEFORE UPDATE ON public.price_list
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage bucket for quotation Excel files
INSERT INTO storage.buckets (id, name, public) VALUES ('quotations', 'quotations', true);

CREATE POLICY "Public read quotations" ON storage.objects FOR SELECT USING (bucket_id = 'quotations');
CREATE POLICY "Public upload quotations" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'quotations');
CREATE POLICY "Public update quotations" ON storage.objects FOR UPDATE USING (bucket_id = 'quotations');
CREATE POLICY "Public delete quotations" ON storage.objects FOR DELETE USING (bucket_id = 'quotations');