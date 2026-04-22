
-- 1. Allow-list table
CREATE TABLE public.allowed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Normalize emails to lowercase
CREATE OR REPLACE FUNCTION public.normalize_allowed_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.email = lower(trim(NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_normalize_allowed_email
BEFORE INSERT OR UPDATE ON public.allowed_emails
FOR EACH ROW EXECUTE FUNCTION public.normalize_allowed_email();

-- Seed the first allowed email
INSERT INTO public.allowed_emails (email) VALUES ('ip.muhammadsaleh@gmail.com');

ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user a team member (their email is on the list)?
CREATE OR REPLACE FUNCTION public.is_team_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.allowed_emails ae
    JOIN auth.users u ON lower(u.email) = ae.email
    WHERE u.id = auth.uid()
  );
$$;

-- Allow-list policies: any team member can read/manage
CREATE POLICY "Team members can view allow-list"
ON public.allowed_emails FOR SELECT TO authenticated
USING (public.is_team_member());

CREATE POLICY "Team members can add to allow-list"
ON public.allowed_emails FOR INSERT TO authenticated
WITH CHECK (public.is_team_member());

CREATE POLICY "Team members can remove from allow-list"
ON public.allowed_emails FOR DELETE TO authenticated
USING (public.is_team_member());

-- 2. Block signups whose email is not on the allow-list
CREATE OR REPLACE FUNCTION public.enforce_allowed_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.allowed_emails WHERE email = lower(NEW.email)
  ) THEN
    RAISE EXCEPTION 'Email % is not authorized to sign up. Contact your team admin.', NEW.email
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_allowed_email
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.enforce_allowed_email();

-- 3. Lock down orders table
DROP POLICY IF EXISTS "Public delete orders" ON public.orders;
DROP POLICY IF EXISTS "Public insert orders" ON public.orders;
DROP POLICY IF EXISTS "Public read orders" ON public.orders;
DROP POLICY IF EXISTS "Public update orders" ON public.orders;

CREATE POLICY "Team can read orders"
ON public.orders FOR SELECT TO authenticated
USING (public.is_team_member());

CREATE POLICY "Team can insert orders"
ON public.orders FOR INSERT TO authenticated
WITH CHECK (public.is_team_member());

CREATE POLICY "Team can update orders"
ON public.orders FOR UPDATE TO authenticated
USING (public.is_team_member())
WITH CHECK (public.is_team_member());

CREATE POLICY "Team can delete orders"
ON public.orders FOR DELETE TO authenticated
USING (public.is_team_member());

-- 4. Lock down price_list table
DROP POLICY IF EXISTS "Public delete price_list" ON public.price_list;
DROP POLICY IF EXISTS "Public insert price_list" ON public.price_list;
DROP POLICY IF EXISTS "Public read price_list" ON public.price_list;
DROP POLICY IF EXISTS "Public update price_list" ON public.price_list;

CREATE POLICY "Team can read price_list"
ON public.price_list FOR SELECT TO authenticated
USING (public.is_team_member());

CREATE POLICY "Team can insert price_list"
ON public.price_list FOR INSERT TO authenticated
WITH CHECK (public.is_team_member());

CREATE POLICY "Team can update price_list"
ON public.price_list FOR UPDATE TO authenticated
USING (public.is_team_member())
WITH CHECK (public.is_team_member());

CREATE POLICY "Team can delete price_list"
ON public.price_list FOR DELETE TO authenticated
USING (public.is_team_member());

-- 5. Make quotations bucket private and lock down policies
UPDATE storage.buckets SET public = false WHERE id = 'quotations';

DROP POLICY IF EXISTS "Public read quotations" ON storage.objects;
DROP POLICY IF EXISTS "Public insert quotations" ON storage.objects;
DROP POLICY IF EXISTS "Public update quotations" ON storage.objects;
DROP POLICY IF EXISTS "Public delete quotations" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload quotations" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view quotations" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update quotations" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete quotations" ON storage.objects;

CREATE POLICY "Team can read quotation files"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'quotations' AND public.is_team_member());

CREATE POLICY "Team can upload quotation files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'quotations' AND public.is_team_member());

CREATE POLICY "Team can update quotation files"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'quotations' AND public.is_team_member());

CREATE POLICY "Team can delete quotation files"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'quotations' AND public.is_team_member());
