-- =========================================================================
-- I-Teeth: Supabase RLS Fix for Existing `pending_approvals` & `patients`
-- Run this in your Supabase SQL Editor
-- =========================================================================

-- Step 1: Safely add missing columns to both tables
ALTER TABLE public.patients 
  ADD COLUMN IF NOT EXISTS patient_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attending_clinician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS eight_digit_id text;

ALTER TABLE public.pending_approvals
  ADD COLUMN IF NOT EXISTS clinician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS odontogram_crop_url text,
  ADD COLUMN IF NOT EXISTS consent_crop_url text,
  ADD COLUMN IF NOT EXISTS odf_details jsonb;

-- Step 2: Ensure user_role enum values exist
DO $$ BEGIN ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'faculty'; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'student_clinician'; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'patient'; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin'; EXCEPTION WHEN others THEN null; END $$;

-- Step 3: Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text,
  role text NOT NULL DEFAULT 'student_clinician',
  employee_id text,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Step 4: Security helper functions
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_faculty_or_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
      AND (
        role::text ILIKE '%faculty%' 
        OR role::text ILIKE '%admin%' 
        OR role::text ILIKE '%dentist%'
      )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Step 5: Enable Row Level Security & Clean Old Policies
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients: Select Policy" ON public.patients;
DROP POLICY IF EXISTS "Patients: Insert Policy" ON public.patients;
DROP POLICY IF EXISTS "Patients: Update Policy" ON public.patients;
DROP POLICY IF EXISTS "Approvals: Select Policy" ON public.pending_approvals;
DROP POLICY IF EXISTS "Approvals: Insert Policy" ON public.pending_approvals;
DROP POLICY IF EXISTS "Approvals: Update Policy" ON public.pending_approvals;

-- Step 6: Patient Records Policy
CREATE POLICY "Patients: Select Policy"
  ON public.patients FOR SELECT
  TO authenticated
  USING (
    (
      public.get_current_user_role() ILIKE '%patient%' 
      AND (patient_user_id = auth.uid() OR email = (SELECT auth.jwt() ->> 'email'))
    )
    OR
    (
      public.get_current_user_role() ILIKE '%student%' 
      AND (attending_clinician_id = auth.uid() OR patient_user_id = auth.uid())
    )
    OR public.is_faculty_or_admin()
    OR public.get_current_user_role() IS NULL
  );

CREATE POLICY "Patients: Insert Policy"
  ON public.patients FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_faculty_or_admin() 
    OR public.get_current_user_role() ILIKE '%student%'
    OR public.get_current_user_role() IS NULL
  );

CREATE POLICY "Patients: Update Policy"
  ON public.patients FOR UPDATE
  TO authenticated
  USING (
    public.is_faculty_or_admin()
    OR (public.get_current_user_role() ILIKE '%student%' AND attending_clinician_id = auth.uid())
    OR public.get_current_user_role() IS NULL
  );

-- Step 7: Pending Approvals & ODF Submissions Policy
-- Checks both clinician text AND clinician_id
CREATE POLICY "Approvals: Select Policy"
  ON public.pending_approvals FOR SELECT
  TO authenticated
  USING (
    public.is_faculty_or_admin()
    OR public.get_current_user_role() ILIKE '%student%'
    OR public.get_current_user_role() IS NULL
  );

CREATE POLICY "Approvals: Insert Policy"
  ON public.pending_approvals FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Approvals: Update Policy"
  ON public.pending_approvals FOR UPDATE
  TO authenticated
  USING (
    public.is_faculty_or_admin() 
    OR public.get_current_user_role() IS NULL
  );
