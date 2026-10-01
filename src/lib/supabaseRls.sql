-- =========================================================================
-- I-Teeth: Supabase RLS Fix & Database Alignment
-- Copy and run this script in your Supabase SQL Editor (SQL Editor -> New Query -> Run)
-- =========================================================================

-- 1. Ensure columns match the application schema exactly
ALTER TABLE public.patients 
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS medical_history text,
  ADD COLUMN IF NOT EXISTS patient_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attending_clinician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS eight_digit_id text;

-- Ensure unique constraint or index on eight_digit_id for fast lookup
CREATE INDEX IF NOT EXISTS idx_patients_eight_digit_id ON public.patients (eight_digit_id);

ALTER TABLE public.pending_approvals
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS visit_date text,
  ADD COLUMN IF NOT EXISTS clinician text,
  ADD COLUMN IF NOT EXISTS procedure text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS clinician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS odf_details jsonb;

CREATE TABLE IF NOT EXISTS public.treatment_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  dentist_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tooth_number varchar,
  procedure_name text NOT NULL,
  diagnosis text,
  notes text,
  cost numeric DEFAULT 0,
  treatment_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  dentist_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  appointment_date date DEFAULT CURRENT_DATE,
  appointment_time time,
  reason text,
  status text DEFAULT 'scheduled',
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Enable Row-Level Security (RLS) on all tables
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing restrictive policies to prevent 42501 Unauthorized errors
DROP POLICY IF EXISTS "Allow anon all on patients" ON public.patients;
DROP POLICY IF EXISTS "Allow anon all on pending_approvals" ON public.pending_approvals;
DROP POLICY IF EXISTS "Allow anon all on treatment_records" ON public.treatment_records;
DROP POLICY IF EXISTS "Allow anon all on appointments" ON public.appointments;

DROP POLICY IF EXISTS "Patients: Select Policy" ON public.patients;
DROP POLICY IF EXISTS "Patients: Insert Policy" ON public.patients;
DROP POLICY IF EXISTS "Patients: Update Policy" ON public.patients;
DROP POLICY IF EXISTS "Approvals: Select Policy" ON public.pending_approvals;
DROP POLICY IF EXISTS "Approvals: Insert Policy" ON public.pending_approvals;
DROP POLICY IF EXISTS "Approvals: Update Policy" ON public.pending_approvals;

-- 4. Grant access to both anon (public API key) and authenticated users
CREATE POLICY "Allow anon all on patients"
  ON public.patients
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anon all on pending_approvals"
  ON public.pending_approvals
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anon all on treatment_records"
  ON public.treatment_records
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anon all on appointments"
  ON public.appointments
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 5. Storage bucket setup for cropped ODF images
-- Run in Storage -> Create bucket named 'odf-scans' with Public access enabled
INSERT INTO storage.buckets (id, name, public) 
VALUES ('odf-scans', 'odf-scans', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Allow anon public uploads to odf-scans" 
  ON storage.objects FOR INSERT 
  TO anon, authenticated 
  WITH CHECK (bucket_id = 'odf-scans');

CREATE POLICY "Allow public reads from odf-scans" 
  ON storage.objects FOR SELECT 
  TO anon, authenticated 
  USING (bucket_id = 'odf-scans');
