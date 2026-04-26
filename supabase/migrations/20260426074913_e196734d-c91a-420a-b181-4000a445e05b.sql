ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS zoho_estimate_id text,
ADD COLUMN IF NOT EXISTS zoho_estimate_number text,
ADD COLUMN IF NOT EXISTS zoho_pushed_at timestamptz,
ADD COLUMN IF NOT EXISTS zoho_push_error text;