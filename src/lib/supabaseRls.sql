-- =========================================================================
-- I-Teeth: Complete Role-Based Access Control (RLS), Ledger & Server-Side RPCs
-- Compliant with Clinical Audit Integrity, Least Privilege, and Data Privacy Act
-- Copy and run this script in your Supabase SQL Editor (SQL Editor -> New Query -> Run)
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================================
-- 1. Profiles Table & Role Infrastructure
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  employee_id text,
  role text NOT NULL DEFAULT 'student_clinician' CHECK (role IN ('student_clinician', 'faculty', 'admin', 'patient')),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS employee_id text,
  ADD COLUMN IF NOT EXISTS role text DEFAULT 'student_clinician',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_profiles_role_status ON public.profiles (role, status);

-- Helper function to fetch caller role safely (Security Definer avoids infinite recursion)
CREATE OR REPLACE FUNCTION public.app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND status = 'approved' LIMIT 1;
$$;

-- Helper function to fetch caller approval status
CREATE OR REPLACE FUNCTION public.app_status()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT status FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- Trigger to automatically populate public.profiles when an auth user is created
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_name text;
  v_status text;
BEGIN
  v_role := COALESCE(new.raw_user_meta_data->>'role', 'student_clinician');
  IF v_role NOT IN ('student_clinician', 'faculty', 'admin', 'patient') THEN
    v_role := 'student_clinician';
  END IF;

  v_name := COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
  
  -- Faculty & Admin signups require manual admin approval; students are approved by default
  IF v_role IN ('faculty', 'admin') THEN
    v_status := 'pending';
  ELSE
    v_status := 'approved';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, status)
  VALUES (new.id, new.email, v_name, v_role, v_status)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        updated_at = timezone('utc'::text, now());
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
DROP POLICY IF EXISTS "profile_self_read" ON public.profiles;

-- Self can read their own profile; faculty and admins can view clinic roster
CREATE POLICY "profiles_select_policy"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.app_role() IN ('faculty', 'admin'));

-- CRITICAL ADVISOR REQUIREMENT: Users CANNOT update their own role or status.
-- Only approved Administrators can update profile roles and approval statuses.
CREATE POLICY "profiles_update_policy"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

-- Self insertion fallback for legacy auth migrations
CREATE POLICY "profiles_insert_policy"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid() AND role = 'student_clinician');

-- =========================================================================
-- 2. Core Clinical Tables & Schema Alignment
-- =========================================================================

-- Patients Table
CREATE TABLE IF NOT EXISTS public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text,
  last_name text,
  email text,
  phone text,
  date_of_birth date,
  gender text,
  medical_history text,
  patient_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  attending_clinician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  eight_digit_id text,
  latest_odf_scan_url text,
  latest_odf_page2_url text,
  is_deleted boolean DEFAULT false,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

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
  ADD COLUMN IF NOT EXISTS eight_digit_id text,
  ADD COLUMN IF NOT EXISTS latest_odf_scan_url text,
  ADD COLUMN IF NOT EXISTS latest_odf_page2_url text,
  ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_patients_eight_digit_id ON public.patients (eight_digit_id);
CREATE INDEX IF NOT EXISTS idx_patients_is_deleted ON public.patients (is_deleted);

-- Pending Approvals Table
CREATE TABLE IF NOT EXISTS public.pending_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eight_digit_id text,
  name text,
  visit_date text,
  clinician text,
  submitted_by text,
  clinician_email text,
  procedure text,
  notes text,
  status text DEFAULT 'pending',
  clinician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  raw_scan_url text,
  raw_scan_page2_url text,
  odontogram_crop_url text,
  consent_crop_url text,
  odf_details jsonb,
  review_feedback jsonb,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  is_deleted boolean DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.pending_approvals
  ADD COLUMN IF NOT EXISTS eight_digit_id text,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS visit_date text,
  ADD COLUMN IF NOT EXISTS clinician text,
  ADD COLUMN IF NOT EXISTS submitted_by text,
  ADD COLUMN IF NOT EXISTS clinician_email text,
  ADD COLUMN IF NOT EXISTS procedure text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS clinician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS raw_scan_url text,
  ADD COLUMN IF NOT EXISTS raw_scan_page2_url text,
  ADD COLUMN IF NOT EXISTS odontogram_crop_url text,
  ADD COLUMN IF NOT EXISTS consent_crop_url text,
  ADD COLUMN IF NOT EXISTS odf_details jsonb,
  ADD COLUMN IF NOT EXISTS review_feedback jsonb,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT timezone('utc'::text, now());

ALTER TABLE public.pending_approvals
  ALTER COLUMN clinician_id SET DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS idx_pending_approvals_eight_digit_id ON public.pending_approvals (eight_digit_id);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_status ON public.pending_approvals (status);

-- Treatment Records Table
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
  document_image_url text,
  raw_scan_url text,
  raw_scan_page2_url text,
  approval_signature text,
  is_deleted boolean DEFAULT false,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.treatment_records
  ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS dentist_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tooth_number varchar,
  ADD COLUMN IF NOT EXISTS procedure_name text,
  ADD COLUMN IF NOT EXISTS diagnosis text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS treatment_date date DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS document_image_url text,
  ADD COLUMN IF NOT EXISTS raw_scan_url text,
  ADD COLUMN IF NOT EXISTS raw_scan_page2_url text,
  ADD COLUMN IF NOT EXISTS approval_signature text,
  ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now());

-- Appointments Table
CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  dentist_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  appointment_date date DEFAULT CURRENT_DATE,
  appointment_time time,
  reason text,
  status text DEFAULT 'scheduled',
  is_deleted boolean DEFAULT false,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS dentist_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appointment_date date DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS appointment_time time,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now());

-- Clinical Graduation Requirements Table
CREATE TABLE IF NOT EXISTS public.clinical_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_level text NOT NULL,
  procedure_category text NOT NULL,
  procedure_code text,
  procedure_name text NOT NULL,
  required_count integer NOT NULL DEFAULT 1,
  unit text DEFAULT 'cases',
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.clinical_requirements
  ADD COLUMN IF NOT EXISTS clinic_level text,
  ADD COLUMN IF NOT EXISTS procedure_category text,
  ADD COLUMN IF NOT EXISTS procedure_code text,
  ADD COLUMN IF NOT EXISTS procedure_name text,
  ADD COLUMN IF NOT EXISTS required_count integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit text DEFAULT 'cases',
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now());

-- Student Requirement Credits Table
CREATE TABLE IF NOT EXISTS public.student_requirement_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  student_email text NOT NULL,
  student_name text,
  requirement_id uuid REFERENCES public.clinical_requirements(id) ON DELETE SET NULL,
  clinic_level text NOT NULL,
  procedure_category text NOT NULL,
  procedure_name text NOT NULL,
  patient_eight_digit_id text,
  patient_name text,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by_name text,
  approved_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.student_requirement_credits
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS student_email text,
  ADD COLUMN IF NOT EXISTS student_name text,
  ADD COLUMN IF NOT EXISTS requirement_id uuid REFERENCES public.clinical_requirements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS clinic_level text,
  ADD COLUMN IF NOT EXISTS procedure_category text,
  ADD COLUMN IF NOT EXISTS procedure_name text,
  ADD COLUMN IF NOT EXISTS patient_eight_digit_id text,
  ADD COLUMN IF NOT EXISTS patient_name text,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by_name text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_student_credits_email ON public.student_requirement_credits (student_email);
CREATE INDEX IF NOT EXISTS idx_student_credits_student_id ON public.student_requirement_credits (student_id);

-- Clinical Audit Ledger (Cryptographic Hash-Chained Audit Trail)
CREATE TABLE IF NOT EXISTS public.clinical_audit_ledger (
  seq_num bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  timestamp timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  action_type text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,
  user_role text,
  eight_digit_id text,
  target_id text,
  record_hash text NOT NULL,
  prev_chain_hash text NOT NULL,
  chain_hash text NOT NULL,
  record_snapshot jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.clinical_audit_ledger
  ADD COLUMN IF NOT EXISTS event_id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS timestamp timestamptz DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS action_type text,
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS user_email text,
  ADD COLUMN IF NOT EXISTS user_role text,
  ADD COLUMN IF NOT EXISTS eight_digit_id text,
  ADD COLUMN IF NOT EXISTS target_id text,
  ADD COLUMN IF NOT EXISTS record_hash text,
  ADD COLUMN IF NOT EXISTS prev_chain_hash text,
  ADD COLUMN IF NOT EXISTS chain_hash text,
  ADD COLUMN IF NOT EXISTS record_snapshot jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_audit_seq_num ON public.clinical_audit_ledger (seq_num);

-- =========================================================================
-- 3. Row-Level Security (RLS) Configuration & Strict Policies
-- =========================================================================

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_requirement_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_audit_ledger ENABLE ROW LEVEL SECURITY;

-- Drop all old and open policies
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

DROP POLICY IF EXISTS "patients_read" ON public.patients;
DROP POLICY IF EXISTS "patients_update" ON public.patients;
DROP POLICY IF EXISTS "patients_insert" ON public.patients;
DROP POLICY IF EXISTS "pending_insert" ON public.pending_approvals;
DROP POLICY IF EXISTS "pending_read" ON public.pending_approvals;
DROP POLICY IF EXISTS "pending_update" ON public.pending_approvals;
DROP POLICY IF EXISTS "treatment_records_read" ON public.treatment_records;
DROP POLICY IF EXISTS "treatment_records_write" ON public.treatment_records;
DROP POLICY IF EXISTS "treatment_records_update" ON public.treatment_records;
DROP POLICY IF EXISTS "appointments_read" ON public.appointments;
DROP POLICY IF EXISTS "appointments_write" ON public.appointments;
DROP POLICY IF EXISTS "requirements_read" ON public.clinical_requirements;
DROP POLICY IF EXISTS "requirements_manage" ON public.clinical_requirements;
DROP POLICY IF EXISTS "credits_student_read" ON public.student_requirement_credits;
DROP POLICY IF EXISTS "credits_faculty_manage" ON public.student_requirement_credits;
DROP POLICY IF EXISTS "audit_ledger_faculty_select" ON public.clinical_audit_ledger;

-- Revoke all table-level access from anonymous public key
REVOKE ALL ON public.patients FROM anon;
REVOKE ALL ON public.pending_approvals FROM anon;
REVOKE ALL ON public.treatment_records FROM anon;
REVOKE ALL ON public.appointments FROM anon;
REVOKE ALL ON public.clinical_requirements FROM anon;
REVOKE ALL ON public.student_requirement_credits FROM anon;
REVOKE ALL ON public.clinical_audit_ledger FROM anon;

-- Direct inserts/updates/deletes on the audit ledger are REVOKED from all clients
REVOKE INSERT, UPDATE, DELETE ON public.clinical_audit_ledger FROM authenticated;

-- Policies for patients
CREATE POLICY "patients_read" ON public.patients
  FOR SELECT TO authenticated
  USING (
    (NOT COALESCE(is_deleted, false)) AND
    (
      public.app_role() IN ('student_clinician', 'faculty', 'admin') OR
      (public.app_role() = 'patient' AND patient_user_id = auth.uid())
    )
  );

CREATE POLICY "patients_insert" ON public.patients
  FOR INSERT TO authenticated
  WITH CHECK (public.app_role() IN ('student_clinician', 'faculty', 'admin'));

CREATE POLICY "patients_update" ON public.patients
  FOR UPDATE TO authenticated
  USING (public.app_role() IN ('faculty', 'admin'))
  WITH CHECK (public.app_role() IN ('faculty', 'admin'));

-- Policies for pending_approvals:
-- Clinic staff submit as themselves with status 'pending'
CREATE POLICY "pending_insert" ON public.pending_approvals
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_role() IN ('student_clinician', 'faculty', 'admin') AND
    clinician_id = auth.uid() AND
    status = 'pending'
  );

-- Students view their own submissions; faculty/admins view all active submissions
CREATE POLICY "pending_read" ON public.pending_approvals
  FOR SELECT TO authenticated
  USING (
    (NOT COALESCE(is_deleted, false)) AND
    (clinician_id = auth.uid() OR public.app_role() IN ('faculty', 'admin'))
  );

-- Only faculty/admins can update pending items directly (or via approve/decline RPC)
CREATE POLICY "pending_update" ON public.pending_approvals
  FOR UPDATE TO authenticated
  USING (public.app_role() IN ('faculty', 'admin'))
  WITH CHECK (public.app_role() IN ('faculty', 'admin'));

-- Policies for treatment_records
CREATE POLICY "treatment_records_read" ON public.treatment_records
  FOR SELECT TO authenticated
  USING (
    (NOT COALESCE(is_deleted, false)) AND
    (
      public.app_role() IN ('student_clinician', 'faculty', 'admin') OR
      (
        public.app_role() = 'patient' AND
        EXISTS (
          SELECT 1 FROM public.patients p
          WHERE p.id = treatment_records.patient_id
            AND p.patient_user_id = auth.uid()
            AND NOT COALESCE(p.is_deleted, false)
        )
      )
    )
  );

CREATE POLICY "treatment_records_write" ON public.treatment_records
  FOR INSERT TO authenticated
  WITH CHECK (public.app_role() IN ('faculty', 'admin'));

CREATE POLICY "treatment_records_update" ON public.treatment_records
  FOR UPDATE TO authenticated
  USING (public.app_role() IN ('faculty', 'admin'))
  WITH CHECK (public.app_role() IN ('faculty', 'admin'));

-- Policies for appointments
CREATE POLICY "appointments_read" ON public.appointments
  FOR SELECT TO authenticated
  USING (public.app_role() IN ('student_clinician', 'faculty', 'admin'));

CREATE POLICY "appointments_write" ON public.appointments
  FOR ALL TO authenticated
  USING (public.app_role() IN ('student_clinician', 'faculty', 'admin'))
  WITH CHECK (public.app_role() IN ('student_clinician', 'faculty', 'admin'));

-- Policies for clinical_requirements
CREATE POLICY "requirements_read" ON public.clinical_requirements
  FOR SELECT TO authenticated
  USING (public.app_role() IN ('student_clinician', 'faculty', 'admin'));

CREATE POLICY "requirements_manage" ON public.clinical_requirements
  FOR ALL TO authenticated
  USING (public.app_role() IN ('faculty', 'admin'))
  WITH CHECK (public.app_role() IN ('faculty', 'admin'));

-- Policies for student_requirement_credits
CREATE POLICY "credits_student_read" ON public.student_requirement_credits
  FOR SELECT TO authenticated
  USING (
    student_id = auth.uid() OR
    lower(student_email) = lower(auth.jwt()->>'email') OR
    public.app_role() IN ('faculty', 'admin')
  );

CREATE POLICY "credits_faculty_manage" ON public.student_requirement_credits
  FOR ALL TO authenticated
  USING (public.app_role() IN ('faculty', 'admin'))
  WITH CHECK (public.app_role() IN ('faculty', 'admin'));

-- Policies for clinical_audit_ledger
CREATE POLICY "audit_ledger_faculty_select" ON public.clinical_audit_ledger
  FOR SELECT TO authenticated
  USING (public.app_role() IN ('faculty', 'admin'));

-- =========================================================================
-- 4. Cryptographic Record Hash & Audit Chain RPC Functions
-- =========================================================================

-- Deterministic canonical JSON SHA-256 calculation matching JS computeCanonicalRecordHash()
DROP FUNCTION IF EXISTS public.compute_canonical_odf_hash(jsonb);
DROP FUNCTION IF EXISTS public.compute_canonical_odf_hash;
CREATE OR REPLACE FUNCTION public.compute_canonical_odf_hash(p_odf jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_odf jsonb := COALESCE(p_odf, '{}'::jsonb);
  v_allergy_check text;
  v_allergy_specify text;
  v_birth_date text;
  v_blood_pressure text;
  v_chief_complaints text;
  v_consent_clinician text;
  v_consent_crop_json text;
  v_consent_patient text;
  v_eight_digit_id text;
  v_hpi text;
  v_name text;
  v_odontogram_crop_json text;
  v_past_history text;
  v_raw_scan2_json text;
  v_raw_scan_json text;
  v_treatment_plan text;
  v_sex text;
  v_teeth_findings text;
  v_diagnosis text;
  v_canonical_json text;
BEGIN
  v_allergy_check := CASE
    WHEN v_odf->'allergyCheck' = 'true'::jsonb THEN 'present'
    WHEN v_odf->'allergyCheck' = 'false'::jsonb THEN ''
    ELSE btrim(COALESCE(v_odf->>'allergyCheck', ''))
  END;
  v_allergy_specify := btrim(COALESCE(v_odf->>'allergySpecify', ''));
  v_birth_date := btrim(COALESCE(v_odf->>'birthDate', ''));
  v_blood_pressure := btrim(COALESCE(v_odf->>'bloodPressure', ''));

  IF jsonb_typeof(v_odf->'chiefComplaints') = 'array' THEN
    SELECT COALESCE('[' || string_agg(to_json(btrim(elem))::text, ',' ORDER BY ord) || ']', '[]')
    INTO v_chief_complaints
    FROM jsonb_array_elements_text(v_odf->'chiefComplaints') WITH ORDINALITY AS t(elem, ord)
    WHERE btrim(elem) <> '';
  ELSE
    v_chief_complaints := '[]';
  END IF;

  v_consent_clinician := btrim(COALESCE(v_odf->>'consentClinicianName', ''));
  v_consent_crop_json := CASE
    WHEN NULLIF(btrim(COALESCE(v_odf->>'consentCropUrl', '')), '') IS NOT NULL
    THEN to_json(btrim(v_odf->>'consentCropUrl'))::text
    ELSE 'null'
  END;
  v_consent_patient := btrim(COALESCE(v_odf->>'consentPatientName', ''));

  v_eight_digit_id := regexp_replace(COALESCE(v_odf->>'eightDigitId', ''), '\D', '', 'g');
  IF v_eight_digit_id = '' THEN
    v_eight_digit_id := '10000001';
  ELSIF length(v_eight_digit_id) > 8 THEN
    v_eight_digit_id := left(v_eight_digit_id, 8);
  ELSE
    v_eight_digit_id := lpad(v_eight_digit_id, 8, '0');
  END IF;

  v_hpi := btrim(COALESCE(v_odf->>'historyOfPresentIllness', ''));
  v_name := btrim(COALESCE(v_odf->>'name', ''));
  v_odontogram_crop_json := CASE
    WHEN NULLIF(btrim(COALESCE(v_odf->>'odontogramCropUrl', '')), '') IS NOT NULL
    THEN to_json(btrim(v_odf->>'odontogramCropUrl'))::text
    ELSE 'null'
  END;

  IF jsonb_typeof(v_odf->'pastHistory') = 'object' THEN
    SELECT COALESCE('{' || string_agg(to_json(kv.key)::text || ':' || to_json(kv.value)::text, ',' ORDER BY kv.key) || '}', '{}')
    INTO v_past_history
    FROM jsonb_each_text(v_odf->'pastHistory') AS kv(key, value)
    WHERE kv.value IN ('present', 'none');
  ELSE
    v_past_history := '{}';
  END IF;

  v_raw_scan2_json := CASE
    WHEN NULLIF(btrim(COALESCE(v_odf->>'rawScanPage2Url', '')), '') IS NOT NULL
    THEN to_json(btrim(v_odf->>'rawScanPage2Url'))::text
    ELSE 'null'
  END;
  v_raw_scan_json := CASE
    WHEN NULLIF(btrim(COALESCE(v_odf->>'rawScanUrl', '')), '') IS NOT NULL
    THEN to_json(btrim(v_odf->>'rawScanUrl'))::text
    ELSE 'null'
  END;

  IF jsonb_typeof(v_odf->'recommendedTreatmentPlan') = 'array' THEN
    SELECT COALESCE('[' || string_agg(to_json(btrim(elem))::text, ',' ORDER BY ord) || ']', '[]')
    INTO v_treatment_plan
    FROM jsonb_array_elements_text(v_odf->'recommendedTreatmentPlan') WITH ORDINALITY AS t(elem, ord)
    WHERE btrim(elem) <> '';
  ELSE
    v_treatment_plan := '[]';
  END IF;

  v_sex := btrim(COALESCE(v_odf->>'sex', ''));

  IF jsonb_typeof(v_odf->'teethFindings') = 'object' THEN
    SELECT COALESCE('{' || string_agg(to_json(kv.key)::text || ':' || to_json(btrim(kv.value))::text, ',' ORDER BY kv.key) || '}', '{}')
    INTO v_teeth_findings
    FROM jsonb_each_text(v_odf->'teethFindings') AS kv(key, value)
    WHERE btrim(kv.value) <> '';
  ELSE
    v_teeth_findings := '{}';
  END IF;

  IF jsonb_typeof(v_odf->'tentativeDiagnosis') = 'array' THEN
    SELECT COALESCE('[' || string_agg(to_json(btrim(elem))::text, ',' ORDER BY ord) || ']', '[]')
    INTO v_diagnosis
    FROM jsonb_array_elements_text(v_odf->'tentativeDiagnosis') WITH ORDINALITY AS t(elem, ord)
    WHERE btrim(elem) <> '';
  ELSE
    v_diagnosis := '[]';
  END IF;

  v_canonical_json := concat(
    '{',
    '"allergyCheck":', to_json(v_allergy_check)::text, ',',
    '"allergySpecify":', to_json(v_allergy_specify)::text, ',',
    '"birthDate":', to_json(v_birth_date)::text, ',',
    '"bloodPressure":', to_json(v_blood_pressure)::text, ',',
    '"chiefComplaints":', v_chief_complaints, ',',
    '"consentClinicianName":', to_json(v_consent_clinician)::text, ',',
    '"consentCropUrl":', v_consent_crop_json, ',',
    '"consentPatientName":', to_json(v_consent_patient)::text, ',',
    '"eightDigitId":', to_json(v_eight_digit_id)::text, ',',
    '"historyOfPresentIllness":', to_json(v_hpi)::text, ',',
    '"name":', to_json(v_name)::text, ',',
    '"odontogramCropUrl":', v_odontogram_crop_json, ',',
    '"pastHistory":', v_past_history, ',',
    '"rawScanPage2Url":', v_raw_scan2_json, ',',
    '"rawScanUrl":', v_raw_scan_json, ',',
    '"recommendedTreatmentPlan":', v_treatment_plan, ',',
    '"sex":', to_json(v_sex)::text, ',',
    '"teethFindings":', v_teeth_findings, ',',
    '"tentativeDiagnosis":', v_diagnosis,
    '}'
  );

  RETURN encode(sha256(convert_to(v_canonical_json, 'UTF8')), 'hex');
END;
$$;

-- Server-side immutable audit logging with cryptographic chaining
DROP FUNCTION IF EXISTS public.log_clinical_audit_event(text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.log_clinical_audit_event;
CREATE OR REPLACE FUNCTION public.log_clinical_audit_event(
  p_action_type text,
  p_eight_digit_id text,
  p_target_id text,
  p_record_hash text,
  p_record_snapshot jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_user_role text;
  v_prev_chain_hash text;
  v_new_chain_hash text;
  v_entry_record record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: User session required for clinical audit logging.';
  END IF;

  SELECT email, role INTO v_user_email, v_user_role
  FROM public.profiles
  WHERE id = v_user_id;

  -- Fetch most recent chain hash (or genesis hash of 64 zeroes)
  SELECT chain_hash INTO v_prev_chain_hash
  FROM public.clinical_audit_ledger
  ORDER BY seq_num DESC
  LIMIT 1;

  IF v_prev_chain_hash IS NULL THEN
    v_prev_chain_hash := repeat('0', 64);
  END IF;

  -- Calculate next cryptographic block hash
  v_new_chain_hash := encode(
    sha256(
      concat(
        v_prev_chain_hash,
        COALESCE(p_record_hash, repeat('0', 64)),
        p_action_type,
        COALESCE(p_eight_digit_id, ''),
        COALESCE(p_target_id, ''),
        timezone('utc'::text, now())::text
      )::bytea
    ),
    'hex'
  );

  INSERT INTO public.clinical_audit_ledger (
    action_type,
    user_id,
    user_email,
    user_role,
    eight_digit_id,
    target_id,
    record_hash,
    prev_chain_hash,
    chain_hash,
    record_snapshot
  )
  VALUES (
    p_action_type,
    v_user_id,
    COALESCE(v_user_email, auth.jwt()->>'email'),
    COALESCE(v_user_role, 'clinician'),
    p_eight_digit_id,
    p_target_id,
    COALESCE(p_record_hash, repeat('0', 64)),
    v_prev_chain_hash,
    v_new_chain_hash,
    COALESCE(p_record_snapshot, '{}'::jsonb)
  )
  RETURNING * INTO v_entry_record;

  RETURN to_jsonb(v_entry_record);
END;
$$;

-- Revoke direct client access to audit logger: only server-side RPCs may append to the ledger
REVOKE ALL ON FUNCTION public.log_clinical_audit_event(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Verification function to validate audit chain integrity across all records
DROP FUNCTION IF EXISTS public.verify_clinical_audit_chain();
DROP FUNCTION IF EXISTS public.verify_clinical_audit_chain;
CREATE OR REPLACE FUNCTION public.verify_clinical_audit_chain()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_expected_prev text := repeat('0', 64);
  v_expected_hash text;
  v_count integer := 0;
BEGIN
  IF public.app_role() NOT IN ('faculty', 'admin') THEN
    RAISE EXCEPTION 'Access denied. Audit ledger verification is restricted to faculty and administrators.';
  END IF;

  FOR v_row IN
    SELECT * FROM public.clinical_audit_ledger ORDER BY seq_num ASC
  LOOP
    v_count := v_count + 1;
    IF v_row.prev_chain_hash <> v_expected_prev THEN
      RETURN jsonb_build_object(
        'valid', false,
        'tampered_seq', v_row.seq_num,
        'reason', 'Broken chain linkage: prev_chain_hash mismatch',
        'inspected_records', v_count
      );
    END IF;

    v_expected_hash := encode(
      sha256(
        concat(
          v_row.prev_chain_hash,
          v_row.record_hash,
          v_row.action_type,
          COALESCE(v_row.eight_digit_id, ''),
          COALESCE(v_row.target_id, ''),
          v_row.timestamp::text
        )::bytea
      ),
      'hex'
    );

    IF v_row.chain_hash <> v_expected_hash THEN
      RETURN jsonb_build_object(
        'valid', false,
        'tampered_seq', v_row.seq_num,
        'reason', 'Chain hash discrepancy: block hash altered',
        'inspected_records', v_count
      );
    END IF;

    v_expected_prev := v_row.chain_hash;
  END LOOP;

  RETURN jsonb_build_object(
    'valid', true,
    'total_events', v_count,
    'last_chain_hash', v_expected_prev,
    'verified_at', timezone('utc'::text, now())
  );
END;
$$;

-- =========================================================================
-- 5. Atomic RPCs: Submit ODF, Chairside Note, Approval, Decline & Soft-Delete
-- =========================================================================

-- Server-side ODF submission RPC (enforces clinician_id = auth.uid(), hashes & audits atomically)
DROP FUNCTION IF EXISTS public.submit_pending_odf;
CREATE OR REPLACE FUNCTION public.submit_pending_odf(
  p_eight_digit_id text,
  p_name text,
  p_visit_date text,
  p_clinician text,
  p_submitted_by text,
  p_procedure text,
  p_notes text,
  p_raw_scan_url text DEFAULT NULL,
  p_raw_scan_page2_url text DEFAULT NULL,
  p_odontogram_crop_url text DEFAULT NULL,
  p_consent_crop_url text DEFAULT NULL,
  p_odf_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_caller_email text;
  v_clean_id text;
  v_clean_odf jsonb;
  v_computed_hash text;
  v_ocr_conf jsonb;
  v_ocr_verified jsonb;
  v_flagged_count integer := 0;
  v_unverified_count integer := 0;
  v_sub record;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Sign-in required.';
  END IF;

  v_caller_role := public.app_role();
  IF v_caller_role NOT IN ('student_clinician', 'faculty', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: Only clinic staff may submit ODF forms.';
  END IF;

  SELECT email INTO v_caller_email FROM public.profiles WHERE id = v_caller_id;

  v_clean_id := regexp_replace(COALESCE(p_eight_digit_id, ''), '\D', '', 'g');
  IF v_clean_id = '' THEN
    v_clean_id := '10000001';
  ELSIF length(v_clean_id) > 8 THEN
    v_clean_id := left(v_clean_id, 8);
  ELSE
    v_clean_id := lpad(v_clean_id, 8, '0');
  END IF;

  -- Strip forged signature or client hash and normalize eightDigitId before hashing
  v_clean_odf := (COALESCE(p_odf_details, '{}'::jsonb) - 'approvalSignature' - 'submittedRecordHash')
    || jsonb_build_object(
      'eightDigitId', v_clean_id,
      'odontogramCropUrl', COALESCE(p_odontogram_crop_url, p_odf_details->>'odontogramCropUrl'),
      'consentCropUrl', COALESCE(p_consent_crop_url, p_odf_details->>'consentCropUrl')
    );

  v_computed_hash := public.compute_canonical_odf_hash(v_clean_odf);
  v_clean_odf := v_clean_odf || jsonb_build_object('submittedRecordHash', v_computed_hash);

  INSERT INTO public.pending_approvals (
    eight_digit_id,
    name,
    visit_date,
    clinician,
    submitted_by,
    clinician_email,
    clinician_id,
    procedure,
    notes,
    status,
    raw_scan_url,
    raw_scan_page2_url,
    odontogram_crop_url,
    consent_crop_url,
    odf_details
  )
  VALUES (
    v_clean_id,
    COALESCE(NULLIF(btrim(p_name), ''), 'Unnamed Patient'),
    COALESCE(NULLIF(btrim(p_visit_date), ''), to_char(timezone('Asia/Manila', now()), 'MM/DD/YYYY')),
    COALESCE(NULLIF(btrim(p_clinician), ''), 'Unassigned Clinician'),
    COALESCE(NULLIF(btrim(p_submitted_by), ''), v_caller_email),
    COALESCE(v_caller_email, NULLIF(btrim(p_submitted_by), '')),
    v_caller_id,
    COALESCE(NULLIF(btrim(p_procedure), ''), 'Oral Diagnosis Form (ODF)'),
    COALESCE(p_notes, ''),
    'pending',
    COALESCE(p_raw_scan_url, v_clean_odf->>'rawScanUrl'),
    COALESCE(p_raw_scan_page2_url, v_clean_odf->>'rawScanPage2Url'),
    COALESCE(p_odontogram_crop_url, v_clean_odf->>'odontogramCropUrl'),
    COALESCE(p_consent_crop_url, v_clean_odf->>'consentCropUrl'),
    v_clean_odf
  )
  RETURNING * INTO v_sub;

  -- Summarize OCR confidence telemetry server-side
  v_ocr_conf := COALESCE(v_clean_odf->'ocrConfidence', '{}'::jsonb);
  v_ocr_verified := COALESCE(v_clean_odf->'ocrVerifiedFields', '{}'::jsonb);
  IF jsonb_typeof(v_ocr_conf) = 'object' THEN
    SELECT
      count(*) FILTER (WHERE (kv.value)::numeric < 0.85),
      count(*) FILTER (WHERE (kv.value)::numeric < 0.85 AND NOT COALESCE((v_ocr_verified->>kv.key)::boolean, false))
    INTO v_flagged_count, v_unverified_count
    FROM jsonb_each_text(v_ocr_conf) AS kv(key, value)
    WHERE kv.value ~ '^[0-9]+(\.[0-9]+)?$';
  END IF;

  PERFORM public.log_clinical_audit_event(
    'ODF_SUBMITTED',
    v_sub.eight_digit_id,
    v_sub.id::text,
    v_computed_hash,
    jsonb_build_object(
      'name', v_sub.name,
      'procedure', v_sub.procedure,
      'visitDate', v_sub.visit_date,
      'ocrTelemetry', jsonb_build_object(
        'engine', v_clean_odf->>'ocrEngine',
        'flaggedCount', v_flagged_count,
        'unverifiedCount', v_unverified_count
      )
    )
  );

  RETURN to_jsonb(v_sub);
END;
$$;

-- Server-side chairside note RPC (allows student clinicians & faculty to record chairside notes + atomic audit log)
DROP FUNCTION IF EXISTS public.add_chairside_clinical_note;
CREATE OR REPLACE FUNCTION public.add_chairside_clinical_note(
  p_patient_db_id uuid,
  p_eight_digit_id text,
  p_treatment_date date,
  p_procedure_name text,
  p_tooth_number text DEFAULT NULL,
  p_diagnosis text DEFAULT '',
  p_notes text DEFAULT '',
  p_clinician text DEFAULT NULL,
  p_dictation_meta jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_patient record;
  v_clean_proc text;
  v_tr record;
  v_note_hash text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Sign-in required.';
  END IF;

  v_caller_role := public.app_role();
  IF v_caller_role NOT IN ('student_clinician', 'faculty', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: Only clinic staff may add chairside clinical notes.';
  END IF;

  SELECT * INTO v_patient
  FROM public.patients
  WHERE id = p_patient_db_id AND NOT COALESCE(is_deleted, false);

  IF v_patient IS NULL THEN
    RAISE EXCEPTION 'Patient record not found.';
  END IF;

  v_clean_proc := COALESCE(NULLIF(btrim(p_procedure_name), ''), 'Chairside Clinical Progress Note');

  INSERT INTO public.treatment_records (
    patient_id,
    dentist_id,
    treatment_date,
    procedure_name,
    tooth_number,
    diagnosis,
    notes,
    approval_signature
  )
  VALUES (
    v_patient.id,
    v_caller_id,
    COALESCE(p_treatment_date, (timezone('Asia/Manila', now()))::date),
    v_clean_proc,
    NULLIF(btrim(COALESCE(p_tooth_number, '')), ''),
    COALESCE(p_diagnosis, ''),
    COALESCE(p_notes, ''),
    NULL
  )
  RETURNING * INTO v_tr;

  v_note_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'eightDigitId', COALESCE(v_patient.eight_digit_id, p_eight_digit_id),
          'recordId', v_tr.id::text,
          'date', v_tr.treatment_date::text,
          'procedureTitle', v_tr.procedure_name,
          'toothNo', COALESCE(v_tr.tooth_number, ''),
          'diagnosis', COALESCE(v_tr.diagnosis, ''),
          'notes', COALESCE(v_tr.notes, ''),
          'clinicianId', v_caller_id::text
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  PERFORM public.log_clinical_audit_event(
    'CHAIRSIDE_NOTE_ADDED',
    COALESCE(v_patient.eight_digit_id, p_eight_digit_id),
    concat('tr_', v_tr.id::text),
    v_note_hash,
    jsonb_build_object(
      'title', v_tr.procedure_name,
      'toothNo', CASE WHEN v_tr.tooth_number IS NOT NULL THEN concat('Tooth #', v_tr.tooth_number) ELSE NULL END,
      'hasHandoff', COALESCE(v_tr.diagnosis, '') LIKE '[HANDOFF]%',
      'dictatedWithWhisper', p_dictation_meta IS NOT NULL,
      'dictationMeta', p_dictation_meta,
      'clinician', COALESCE(NULLIF(btrim(COALESCE(p_clinician, '')), ''), 'Clinic Staff')
    )
  );

  RETURN to_jsonb(v_tr);
END;
$$;

-- Server-side ODF approval RPC
DROP FUNCTION IF EXISTS public.approve_pending_submission(text, text, text);
DROP FUNCTION IF EXISTS public.approve_pending_submission(text, text);
DROP FUNCTION IF EXISTS public.approve_pending_submission(uuid, text, text);
DROP FUNCTION IF EXISTS public.approve_pending_submission(uuid, text);
DROP FUNCTION IF EXISTS public.approve_pending_submission;
CREATE OR REPLACE FUNCTION public.approve_pending_submission(
  p_submission_id text,
  p_eight_digit_id text,
  p_record_hash text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_caller_id uuid;
  v_caller_name text;
  v_caller_email text;
  v_caller_employee_id text;
  v_sub record;
  v_computed_hash text;
  v_patient_id uuid;
  v_patient_row record;
  v_odf jsonb;
  v_odf_signed jsonb;
  v_patient_meta jsonb;
  v_approval_signature jsonb;
  v_audit_entry jsonb;
  v_proc text;
  v_diagnosis_text text;
  v_first_name text;
  v_last_name text;
  v_name_parts text[];
  v_dob date;
  v_raw_dob text;
  v_now timestamptz := timezone('utc'::text, now());
  v_student_email text;
  v_student_name text;
  v_clinic_level text;
  v_req_row record;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Sign-in required.';
  END IF;

  v_caller_role := public.app_role();
  IF v_caller_role NOT IN ('faculty', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: Only faculty or administrators can approve submissions.';
  END IF;

  SELECT full_name, email, employee_id
  INTO v_caller_name, v_caller_email, v_caller_employee_id
  FROM public.profiles
  WHERE id = v_caller_id;

  -- 1. Locate the specific pending approval submission (must still be pending and not deleted)
  IF p_submission_id IS NOT NULL AND btrim(p_submission_id) <> '' THEN
    IF btrim(p_submission_id) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid submission identifier.';
    END IF;
    SELECT * INTO v_sub
    FROM public.pending_approvals
    WHERE id = btrim(p_submission_id)::uuid
      AND status = 'pending'
      AND NOT COALESCE(is_deleted, false)
    FOR UPDATE;
  ELSE
    SELECT * INTO v_sub
    FROM public.pending_approvals
    WHERE eight_digit_id = p_eight_digit_id
      AND status = 'pending'
      AND NOT COALESCE(is_deleted, false)
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_sub IS NULL THEN
    RAISE EXCEPTION 'Pending submission not found or already processed.';
  END IF;

  v_odf := COALESCE(v_sub.odf_details, '{}'::jsonb) - 'approvalSignature' - 'submittedRecordHash';
  IF COALESCE(NULLIF(v_odf->>'eightDigitId', ''), '') = '' THEN
    v_odf := v_odf || jsonb_build_object('eightDigitId', v_sub.eight_digit_id);
  END IF;

  -- 2. CRITICAL REQUIREMENT: Recalculate canonical hash server-side rather than trusting browser p_record_hash
  v_computed_hash := public.compute_canonical_odf_hash(v_odf);
  v_proc := COALESCE(NULLIF(btrim(v_sub.procedure), ''), 'Approved Oral Diagnosis Form (ODF)');

  -- 3. Write atomic audit event first so ledgerSeq & chain_hash are embedded in approvalSignature
  v_audit_entry := public.log_clinical_audit_event(
    'FACULTY_APPROVED',
    v_sub.eight_digit_id,
    v_sub.id::text,
    v_computed_hash,
    jsonb_build_object(
      'procedure', v_proc,
      'approvedBy', COALESCE(NULLIF(btrim(v_caller_name), ''), v_caller_email, 'Faculty Evaluator'),
      'clinician', v_sub.clinician,
      'submissionId', v_sub.id
    )
  );

  v_approval_signature := jsonb_build_object(
    'signedBy', COALESCE(NULLIF(btrim(v_caller_name), ''), v_caller_email, 'Faculty Evaluator'),
    'employeeId', v_caller_employee_id,
    'signedAt', v_now,
    'recordHash', v_computed_hash,
    'ledgerSeq', (v_audit_entry->>'seq_num')::bigint,
    'ledgerEntryHash', v_audit_entry->>'chain_hash'
  );

  v_odf_signed := v_odf || jsonb_build_object(
    'submittedRecordHash', v_computed_hash,
    'approvalSignature', v_approval_signature
  );

  -- Build patient metadata matching client normalizePatient() contract
  v_patient_meta := jsonb_build_object(
    'eightDigitId', v_sub.eight_digit_id,
    'clinician', COALESCE(v_sub.clinician, 'Unassigned Clinician'),
    'lastVisit', COALESCE(v_sub.visit_date, to_char(timezone('Asia/Manila', v_now), 'MM/DD/YYYY')),
    'procedure', v_proc,
    'notes', COALESCE(NULLIF(v_sub.notes, ''), v_odf->>'historyOfPresentIllness', ''),
    'phone', COALESCE(NULLIF(v_odf->>'cellPhone', ''), v_odf->>'homeTel', ''),
    'email', COALESCE(v_odf->>'email', ''),
    'gender', COALESCE(v_odf->>'sex', ''),
    'dateOfBirth', COALESCE(v_odf->>'birthDate', ''),
    'age', COALESCE(v_odf->>'age', ''),
    'homeAddress', COALESCE(v_odf->>'homeAddress', ''),
    'approvalSignature', v_approval_signature,
    'odfData', v_odf_signed
  );

  v_raw_dob := btrim(COALESCE(v_odf->>'birthDate', ''));
  IF v_raw_dob ~ '^\d{4}-\d{2}-\d{2}$' THEN
    v_dob := v_raw_dob::date;
  ELSIF v_raw_dob ~ '^\d{2}/\d{2}/\d{4}$' THEN
    BEGIN
      v_dob := to_date(v_raw_dob, 'MM/DD/YYYY');
    EXCEPTION WHEN OTHERS THEN
      v_dob := NULL;
    END;
  ELSE
    v_dob := NULL;
  END IF;

  -- 4. Upsert or update patient record in public.patients
  v_name_parts := string_to_array(trim(COALESCE(v_sub.name, v_odf->>'name', 'Unknown Patient')), ' ');
  v_first_name := v_name_parts[1];
  v_last_name := array_to_string(v_name_parts[2:], ' ');
  IF v_last_name IS NULL OR v_last_name = '' THEN
    v_last_name := 'Patient';
  END IF;

  SELECT id INTO v_patient_id FROM public.patients WHERE eight_digit_id = v_sub.eight_digit_id LIMIT 1;

  IF v_patient_id IS NOT NULL THEN
    UPDATE public.patients
    SET first_name = COALESCE(NULLIF(v_first_name, ''), first_name),
        last_name = COALESCE(NULLIF(v_last_name, ''), last_name),
        email = COALESCE(NULLIF(btrim(v_odf->>'email'), ''), email),
        phone = COALESCE(NULLIF(btrim(COALESCE(v_odf->>'cellPhone', v_odf->>'homeTel')), ''), phone),
        gender = COALESCE(NULLIF(btrim(v_odf->>'sex'), ''), gender),
        date_of_birth = COALESCE(v_dob, date_of_birth),
        attending_clinician_id = COALESCE(v_sub.clinician_id, attending_clinician_id),
        medical_history = v_patient_meta::text,
        latest_odf_scan_url = COALESCE(v_sub.raw_scan_url, latest_odf_scan_url),
        latest_odf_page2_url = COALESCE(v_sub.raw_scan_page2_url, latest_odf_page2_url),
        updated_at = v_now,
        is_deleted = false
    WHERE id = v_patient_id
    RETURNING * INTO v_patient_row;
  ELSE
    INSERT INTO public.patients (
      first_name,
      last_name,
      email,
      phone,
      gender,
      date_of_birth,
      attending_clinician_id,
      eight_digit_id,
      medical_history,
      latest_odf_scan_url,
      latest_odf_page2_url
    )
    VALUES (
      v_first_name,
      v_last_name,
      NULLIF(btrim(COALESCE(v_odf->>'email', '')), ''),
      NULLIF(btrim(COALESCE(v_odf->>'cellPhone', v_odf->>'homeTel', '')), ''),
      NULLIF(btrim(COALESCE(v_odf->>'sex', '')), ''),
      v_dob,
      v_sub.clinician_id,
      v_sub.eight_digit_id,
      v_patient_meta::text,
      v_sub.raw_scan_url,
      v_sub.raw_scan_page2_url
    )
    RETURNING * INTO v_patient_row;
    v_patient_id := v_patient_row.id;
  END IF;

  IF jsonb_typeof(v_odf->'tentativeDiagnosis') = 'array' THEN
    SELECT NULLIF(string_agg(btrim(elem), '; '), '')
    INTO v_diagnosis_text
    FROM jsonb_array_elements_text(v_odf->'tentativeDiagnosis') AS elem
    WHERE btrim(elem) <> '';
  ELSE
    v_diagnosis_text := NULLIF(btrim(COALESCE(v_odf->>'tentativeDiagnosis', '')), '');
  END IF;

  -- 5. Insert treatment record with faculty approval
  INSERT INTO public.treatment_records (
    patient_id,
    dentist_id,
    procedure_name,
    diagnosis,
    notes,
    document_image_url,
    raw_scan_url,
    raw_scan_page2_url,
    approval_signature
  )
  VALUES (
    v_patient_id,
    v_caller_id,
    v_proc,
    COALESCE(v_diagnosis_text, 'ODF Documented'),
    COALESCE(NULLIF(v_sub.notes, ''), 'Faculty approved procedure and ODF documentation.'),
    v_sub.raw_scan_url,
    v_sub.raw_scan_url,
    v_sub.raw_scan_page2_url,
    COALESCE(NULLIF(btrim(v_caller_name), ''), v_caller_email, 'Faculty Evaluator')
  );

  -- 6. Mark pending approval as approved and persist signed ODF payload
  UPDATE public.pending_approvals
  SET status = 'approved',
      odf_details = v_odf_signed,
      reviewed_by = v_caller_id,
      reviewed_at = v_now,
      updated_at = v_now
  WHERE id = v_sub.id;

  -- 7. Credit student clinical requirements when submitted by an identifiable student clinician
  SELECT email, full_name INTO v_student_email, v_student_name
  FROM public.profiles
  WHERE id = v_sub.clinician_id;

  v_student_email := COALESCE(NULLIF(btrim(v_student_email), ''), NULLIF(btrim(v_sub.submitted_by), ''), NULLIF(btrim(v_sub.clinician_email), ''));
  IF v_student_email IS NOT NULL THEN
    v_clinic_level := COALESCE(NULLIF(btrim(v_odf->>'clinicLevel'), ''), 'Clinic I');
    SELECT * INTO v_req_row
    FROM public.clinical_requirements
    WHERE clinic_level = v_clinic_level
      AND (lower(procedure_name) = lower(v_proc) OR procedure_code = 'ODF-01')
    ORDER BY (lower(procedure_name) = lower(v_proc)) DESC
    LIMIT 1;

    INSERT INTO public.student_requirement_credits (
      student_id,
      student_email,
      student_name,
      requirement_id,
      clinic_level,
      procedure_category,
      procedure_name,
      patient_eight_digit_id,
      patient_name,
      approved_by,
      approved_by_name,
      approved_at
    )
    VALUES (
      v_sub.clinician_id,
      v_student_email,
      COALESCE(NULLIF(btrim(v_student_name), ''), split_part(v_student_email, '@', 1)),
      v_req_row.id,
      COALESCE(v_req_row.clinic_level, v_clinic_level),
      COALESCE(v_req_row.procedure_category, 'Oral Diagnosis'),
      COALESCE(v_req_row.procedure_name, v_proc),
      v_sub.eight_digit_id,
      COALESCE(v_sub.name, concat_ws(' ', v_first_name, v_last_name)),
      v_caller_id,
      COALESCE(NULLIF(btrim(v_caller_name), ''), v_caller_email, 'Faculty Evaluator'),
      v_now
    );
  END IF;

  RETURN to_jsonb(v_patient_row);
END;
$$;

-- Server-side decline submission RPC
DROP FUNCTION IF EXISTS public.decline_pending_submission(text, jsonb);
DROP FUNCTION IF EXISTS public.decline_pending_submission(text);
DROP FUNCTION IF EXISTS public.decline_pending_submission(uuid, jsonb);
DROP FUNCTION IF EXISTS public.decline_pending_submission;
CREATE OR REPLACE FUNCTION public.decline_pending_submission(
  p_submission_id text,
  p_review_feedback jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_caller_name text;
  v_sub record;
  v_hash text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Sign-in required.';
  END IF;

  v_caller_role := public.app_role();
  IF v_caller_role NOT IN ('faculty', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: Only faculty or administrators can decline submissions.';
  END IF;

  IF p_submission_id IS NULL OR btrim(p_submission_id) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid submission identifier.';
  END IF;

  SELECT full_name INTO v_caller_name FROM public.profiles WHERE id = v_caller_id;

  SELECT * INTO v_sub
  FROM public.pending_approvals
  WHERE id = btrim(p_submission_id)::uuid
    AND status = 'pending'
    AND NOT COALESCE(is_deleted, false)
  FOR UPDATE;

  IF v_sub IS NULL THEN
    RAISE EXCEPTION 'Pending submission not found or already processed.';
  END IF;

  UPDATE public.pending_approvals
  SET status = 'declined',
      review_feedback = p_review_feedback,
      reviewed_by = v_caller_id,
      reviewed_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE id = v_sub.id
  RETURNING * INTO v_sub;

  v_hash := public.compute_canonical_odf_hash(v_sub.odf_details);

  -- Atomic audit log entry
  PERFORM public.log_clinical_audit_event(
    'FACULTY_DECLINED',
    v_sub.eight_digit_id,
    v_sub.id::text,
    v_hash,
    jsonb_build_object(
      'submissionId', v_sub.id,
      'declinedBy', v_caller_name,
      'feedback', p_review_feedback
    )
  );

  RETURN to_jsonb(v_sub);
END;
$$;

-- Atomic Soft-Delete Patient RPC
DROP FUNCTION IF EXISTS public.soft_delete_patient(text, text);
DROP FUNCTION IF EXISTS public.soft_delete_patient(text);
DROP FUNCTION IF EXISTS public.soft_delete_patient;
CREATE OR REPLACE FUNCTION public.soft_delete_patient(
  p_eight_digit_id text,
  p_reason text DEFAULT 'Patient record soft-deleted by authorized faculty/admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_caller_name text;
  v_patient record;
  v_now timestamptz := timezone('utc'::text, now());
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Sign-in required.';
  END IF;

  v_caller_role := public.app_role();
  IF v_caller_role NOT IN ('faculty', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: Only faculty or administrators can delete patient records.';
  END IF;

  SELECT full_name INTO v_caller_name FROM public.profiles WHERE id = v_caller_id;

  SELECT * INTO v_patient
  FROM public.patients
  WHERE eight_digit_id = p_eight_digit_id
    AND NOT COALESCE(is_deleted, false)
  FOR UPDATE;

  IF v_patient IS NULL THEN
    RAISE EXCEPTION 'Patient not found.';
  END IF;

  -- 1. Soft-delete pending approvals
  UPDATE public.pending_approvals
  SET is_deleted = true,
      deleted_at = v_now
  WHERE eight_digit_id = p_eight_digit_id;

  -- 2. Soft-delete treatment records
  UPDATE public.treatment_records
  SET is_deleted = true,
      deleted_at = v_now,
      deleted_by = v_caller_id
  WHERE patient_id = v_patient.id;

  -- 3. Soft-delete patient record
  UPDATE public.patients
  SET is_deleted = true,
      deleted_at = v_now,
      deleted_by = v_caller_id
  WHERE id = v_patient.id;

  -- 4. Atomic audit log entry
  PERFORM public.log_clinical_audit_event(
    'PATIENT_DELETED',
    p_eight_digit_id,
    v_patient.id::text,
    repeat('0', 64),
    jsonb_build_object(
      'reason', p_reason,
      'deletedBy', v_caller_name,
      'patientName', concat(v_patient.first_name, ' ', v_patient.last_name)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'eightDigitId', p_eight_digit_id,
    'deletedAt', v_now
  );
END;
$$;

-- Atomic Soft-Delete Records RPC (enforces patient ownership)
DROP FUNCTION IF EXISTS public.soft_delete_treatment_records(uuid[], text);
DROP FUNCTION IF EXISTS public.soft_delete_treatment_records(uuid[]);
DROP FUNCTION IF EXISTS public.soft_delete_treatment_records;
CREATE OR REPLACE FUNCTION public.soft_delete_treatment_records(
  p_record_ids uuid[],
  p_eight_digit_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_patient_id uuid;
  v_tr_count integer := 0;
  v_pa_count integer := 0;
  v_now timestamptz := timezone('utc'::text, now());
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Sign-in required.';
  END IF;

  v_caller_role := public.app_role();
  IF v_caller_role NOT IN ('faculty', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: Only faculty or administrators can delete treatment records.';
  END IF;

  SELECT id INTO v_patient_id
  FROM public.patients
  WHERE eight_digit_id = p_eight_digit_id
  LIMIT 1;

  -- Soft-delete matching treatment records belonging to this patient
  IF v_patient_id IS NOT NULL THEN
    UPDATE public.treatment_records
    SET is_deleted = true,
        deleted_at = v_now,
        deleted_by = v_caller_id
    WHERE id = ANY(p_record_ids)
      AND patient_id = v_patient_id
      AND NOT COALESCE(is_deleted, false);
    GET DIAGNOSTICS v_tr_count = ROW_COUNT;
  END IF;

  -- Soft-delete matching pending approvals belonging to this patient
  UPDATE public.pending_approvals
  SET is_deleted = true,
      deleted_at = v_now
  WHERE id = ANY(p_record_ids)
    AND eight_digit_id = p_eight_digit_id
    AND NOT COALESCE(is_deleted, false);
  GET DIAGNOSTICS v_pa_count = ROW_COUNT;

  IF (v_tr_count + v_pa_count) = 0 THEN
    RAISE EXCEPTION 'No matching records found for patient %.', p_eight_digit_id;
  END IF;

  -- Atomic audit log entry
  PERFORM public.log_clinical_audit_event(
    'RECORD_DELETED',
    p_eight_digit_id,
    array_to_string(p_record_ids, ','),
    repeat('0', 64),
    jsonb_build_object(
      'deletedRecordCount', v_tr_count + v_pa_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'deletedCount', v_tr_count + v_pa_count,
    'deletedAt', v_now
  );
END;
$$;

-- Restrict RPC execution grants explicitly to authenticated clinic users
REVOKE ALL ON FUNCTION public.submit_pending_odf(text, text, text, text, text, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_pending_odf(text, text, text, text, text, text, text, text, text, text, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.add_chairside_clinical_note(uuid, text, date, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_chairside_clinical_note(uuid, text, date, text, text, text, text, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_pending_submission(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_pending_submission(text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.decline_pending_submission(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_pending_submission(text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.soft_delete_patient(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_patient(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.soft_delete_treatment_records(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_treatment_records(uuid[], text) TO authenticated;

REVOKE ALL ON FUNCTION public.verify_clinical_audit_chain() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_clinical_audit_chain() TO authenticated;

-- =========================================================================
-- 6. Storage Bucket Configuration (Private Bucket)
-- =========================================================================

INSERT INTO storage.buckets (id, name, public) 
VALUES ('odf-scans', 'odf-scans', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Allow anon public uploads to odf-scans" ON storage.objects;
DROP POLICY IF EXISTS "Allow public reads from odf-scans" ON storage.objects;
DROP POLICY IF EXISTS "Allow clinic staff uploads to odf-scans" ON storage.objects;
DROP POLICY IF EXISTS "Allow clinic staff reads from odf-scans" ON storage.objects;

CREATE POLICY "Allow clinic staff uploads to odf-scans" 
  ON storage.objects FOR INSERT 
  TO authenticated 
  WITH CHECK (
    bucket_id = 'odf-scans' AND 
    public.app_role() IN ('student_clinician', 'faculty', 'admin')
  );

CREATE POLICY "Allow clinic staff reads from odf-scans" 
  ON storage.objects FOR SELECT 
  TO authenticated 
  USING (
    bucket_id = 'odf-scans' AND 
    public.app_role() IN ('student_clinician', 'faculty', 'admin')
  );

-- =========================================================================
-- 7. Initial Seed for Clinical Requirements (CEU Standard Curriculum)
-- =========================================================================

DO $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT *
    FROM (
      VALUES
        ('Clinic I', 'Restorative', 'REST-01', 'Class I Amalgam/Composite Restoration', 10, 'cases'),
        ('Clinic I', 'Restorative', 'REST-02', 'Class II Amalgam/Composite Restoration', 8, 'cases'),
        ('Clinic I', 'Periodontics', 'PERIO-01', 'Oral Prophylaxis (Light to Moderate)', 12, 'cases'),
        ('Clinic I', 'Oral Diagnosis', 'ODF-01', 'Complete Oral Diagnosis & Charting (ODF)', 15, 'cases'),
        ('Clinic II', 'Restorative', 'REST-03', 'Class III/IV Anterior Composite', 6, 'cases'),
        ('Clinic II', 'Oral Surgery', 'SURG-01', 'Simple Tooth Extraction', 10, 'cases'),
        ('Clinic II', 'Periodontics', 'PERIO-02', 'Scaling and Root Planing (Deep)', 8, 'cases'),
        ('Clinic II', 'Prosthodontics', 'PROS-01', 'Complete Denture Fabrication', 2, 'cases'),
        ('Clinic II', 'Endodontics', 'ENDO-01', 'Anterior Root Canal Therapy', 2, 'cases')
    ) AS v(clinic_level, procedure_category, procedure_code, procedure_name, required_count, unit)
  LOOP
    BEGIN
      INSERT INTO public.clinical_requirements (
        clinic_level,
        procedure_category,
        procedure_code,
        procedure_name,
        required_count,
        unit
      )
      SELECT
        v_row.clinic_level,
        v_row.procedure_category,
        v_row.procedure_code,
        v_row.procedure_name,
        v_row.required_count,
        v_row.unit
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.clinical_requirements cr
        WHERE cr.clinic_level = v_row.clinic_level
          AND (cr.procedure_code = v_row.procedure_code OR cr.procedure_name = v_row.procedure_name)
      );
    EXCEPTION WHEN unique_violation THEN
      -- Skip cleanly if live table has an existing constraint on (clinic_level, procedure_category)
      NULL;
    END;
  END LOOP;
END;
$$;
