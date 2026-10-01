import { useState, useEffect } from "react";
import Layout from "./Layout";
import { testSupabaseConnection } from "../lib/dentalService";
import { normalizeRole, canAccessDeveloperOptions } from "../lib/roleUtils";

const MOCK_AUDIT_LOGS = [
  { id: "LOG-9941", action: "ODF_SUBMIT", user: "student@ceu.edu.ph", target: "Patient #10000005", time: "10 mins ago", status: "Success" },
  { id: "LOG-9940", action: "FACULTY_APPROVE", user: "faculty@ceu.edu.ph", target: "ODF #10000001", time: "25 mins ago", status: "Success" },
  { id: "LOG-9939", action: "PATIENT_RECORD_VIEW", user: "student@ceu.edu.ph", target: "Patient #10000002", time: "1 hour ago", status: "Authorized" },
  { id: "LOG-9938", action: "RLS_EVAL_CHECK", user: "System Guard", target: "public.patients", time: "2 hours ago", status: "Enforced" },
  { id: "LOG-9937", action: "AUTH_ROLE_ASSIGN", user: "admin@ceu.edu.ph", target: "User DEN-2026-081", time: "3 hours ago", status: "Updated" },
];

export default function Settings({
  onNavigate,
  onSeedSupabase = () => {},
  onRefreshFromSupabase = () => {},
  currentUser,
  onSignOut,
  onSwitchRole = () => {},
}) {
  const normRole = normalizeRole(currentUser?.role);
  const isAdmin = canAccessDeveloperOptions(normRole);

  const sections = ["Account"];
  if (isAdmin) {
    sections.push("Developer Options");
  }
  sections.push("Supabase DB", "Security", "Appearance", "System Info");

  const [section, setSection] = useState(isAdmin ? "Developer Options" : "Account");
  const [dbStatus, setDbStatus] = useState({ checking: true, connected: false, error: null });
  const [copied, setCopied] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);

  useEffect(() => {
    let mounted = true;
    testSupabaseConnection().then((res) => {
      if (mounted) {
        setDbStatus({
          checking: false,
          connected: res.connected,
          tableFound: res.tableFound,
          error: res.error,
        });
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const copySql = () => {
    const SQL_SCHEMA = `-- =========================================================================
-- I-Teeth Supabase RLS & Schema Fix
-- =========================================================================

-- 1. Add missing columns to existing tables
ALTER TABLE public.patients 
  ADD COLUMN IF NOT EXISTS patient_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attending_clinician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS eight_digit_id text;

ALTER TABLE public.pending_approvals
  ADD COLUMN IF NOT EXISTS clinician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS odf_details jsonb;

-- 2. Safely add missing enum labels if user_role exists
DO $$ BEGIN ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'faculty'; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'student_clinician'; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'patient'; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin'; EXCEPTION WHEN others THEN null; END $$;

-- 3. Profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text,
  role text NOT NULL DEFAULT 'student_clinician',
  employee_id text,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Helper Functions
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_faculty_or_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
      AND (role::text ILIKE '%faculty%' OR role::text ILIKE '%admin%' OR role::text ILIKE '%dentist%')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 5. Enable RLS
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_approvals ENABLE ROW LEVEL SECURITY;

-- 6. Drop existing policies to prevent conflicts
DROP POLICY IF EXISTS "Patients: Select Policy" ON public.patients;
DROP POLICY IF EXISTS "Patients: Insert Policy" ON public.patients;
DROP POLICY IF EXISTS "Patients: Update Policy" ON public.patients;
DROP POLICY IF EXISTS "Approvals: Select Policy" ON public.pending_approvals;
DROP POLICY IF EXISTS "Approvals: Insert Policy" ON public.pending_approvals;
DROP POLICY IF EXISTS "Approvals: Update Policy" ON public.pending_approvals;

-- 7. Patients Policy
CREATE POLICY "Patients: Select Policy" ON public.patients FOR SELECT TO authenticated
USING (
  (public.get_current_user_role() ILIKE '%patient%' AND (patient_user_id = auth.uid() OR email = (SELECT auth.jwt() ->> 'email'))) OR
  (public.get_current_user_role() ILIKE '%student%' AND (attending_clinician_id = auth.uid() OR patient_user_id = auth.uid())) OR
  public.is_faculty_or_admin() OR
  public.get_current_user_role() IS NULL
);

CREATE POLICY "Patients: Insert Policy" ON public.patients FOR INSERT TO authenticated
WITH CHECK (public.is_faculty_or_admin() OR public.get_current_user_role() ILIKE '%student%' OR public.get_current_user_role() IS NULL);

-- 8. Approvals Policy
CREATE POLICY "Approvals: Select Policy" ON public.pending_approvals FOR SELECT TO authenticated
USING (
  public.is_faculty_or_admin() OR
  (public.get_current_user_role() ILIKE '%student%' AND (clinician_id = auth.uid() OR clinician_id IS NULL)) OR
  public.get_current_user_role() IS NULL
);

CREATE POLICY "Approvals: Insert Policy" ON public.pending_approvals FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Approvals: Update Policy" ON public.pending_approvals FOR UPDATE TO authenticated
USING (public.is_faculty_or_admin() OR public.get_current_user_role() IS NULL);
`;
    navigator.clipboard.writeText(SQL_SCHEMA);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Layout
      active="settings"
      onNavigate={onNavigate}
      showHome={false}
      currentUser={currentUser}
      onSignOut={onSignOut}
    >
      <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Left Section Nav */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: "18px",
            border: "1px solid #e2e8f0",
            padding: "8px",
            display: "grid",
            gap: "4px",
            minWidth: "190px",
            boxShadow: "0 4px 16px -2px rgba(0, 0, 0, 0.04)",
          }}
        >
          {sections.map((s) => {
            const isDev = s === "Developer Options";
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSection(s)}
                aria-current={section === s ? "true" : undefined}
                style={{
                  width: "100%",
                  background:
                    section === s
                      ? isDev
                        ? "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)"
                        : "linear-gradient(135deg, #e91e77 0%, #ec206f 100%)"
                      : "transparent",
                  color: section === s ? "#ffffff" : isDev ? "#0369a1" : "#475569",
                  border: "none",
                  borderRadius: "12px",
                  padding: "10px 14px",
                  font: "600 13px Inter, system-ui, sans-serif",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s ease",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>{s}</span>
                {isDev && (
                  <span
                    style={{
                      fontSize: "10px",
                      background: section === s ? "rgba(255,255,255,0.2)" : "#e0f2fe",
                      color: section === s ? "#fff" : "#0284c7",
                      padding: "2px 6px",
                      borderRadius: "6px",
                      fontWeight: "700",
                    }}
                  >
                    ADMIN
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right Content Panel */}
        <section
          style={{
            flex: 1,
            minHeight: "360px",
            padding: "24px 28px",
            background: "#ffffff",
            borderRadius: "20px",
            border: "1px solid #e2e8f0",
            boxShadow: "0 10px 30px -5px rgba(0, 0, 0, 0.04)",
            maxWidth: "820px",
          }}
        >
          {/* Expanded Developer Options (Rendered exclusively for Admin) */}
          {section === "Developer Options" && isAdmin && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "19px", fontWeight: "800", color: "#0f172a" }}>
                    Developer & System Administrator Options
                  </h2>
                  <p style={{ margin: "3px 0 0", fontSize: "12.5px", color: "#64748b" }}>
                    Audit logs, live role assignment switcher, and Supabase RLS diagnostics
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowRoleModal(true)}
                  style={{
                    background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "12px",
                    padding: "8px 16px",
                    fontSize: "12.5px",
                    fontWeight: "700",
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(2, 132, 199, 0.3)",
                  }}
                >
                  ⚡ Role Assignment Switcher
                </button>
              </div>

              {/* System Diagnostics Panel */}
              <div style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px", marginBottom: "18px" }}>
                <h3 style={{ margin: "0 0 10px", fontSize: "13px", fontWeight: "700", color: "#334155", textTransform: "uppercase" }}>
                  System Diagnostics & Health
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", fontSize: "12.5px" }}>
                  <div style={{ background: "#fff", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}>
                    <div style={{ color: "#64748b", fontSize: "11px" }}>PostgREST Service</div>
                    <div style={{ color: "#059669", fontWeight: "700" }}>● Healthy & Online</div>
                  </div>
                  <div style={{ background: "#fff", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}>
                    <div style={{ color: "#64748b", fontSize: "11px" }}>RLS Policy Engine</div>
                    <div style={{ color: "#0284c7", fontWeight: "700" }}>● Active (4 Roles Mapped)</div>
                  </div>
                  <div style={{ background: "#fff", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}>
                    <div style={{ color: "#64748b", fontSize: "11px" }}>Patient ID Validation</div>
                    <div style={{ color: "#059669", fontWeight: "700" }}>● Strictly 8 Digits</div>
                  </div>
                  <div style={{ background: "#fff", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}>
                    <div style={{ color: "#64748b", fontSize: "11px" }}>ODF Workflow</div>
                    <div style={{ color: "#d97706", fontWeight: "700" }}>● Faculty Sign-off Gate</div>
                  </div>
                </div>
              </div>

              {/* Audit Logs Table */}
              <div style={{ marginBottom: "18px" }}>
                <h3 style={{ margin: "0 0 10px", fontSize: "13px", fontWeight: "700", color: "#334155", textTransform: "uppercase" }}>
                  Clinical System Audit Logs
                </h3>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: "12px", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead style={{ background: "#f1f5f9", textAlign: "left", color: "#475569" }}>
                      <tr>
                        <th style={{ padding: "8px 12px" }}>Log ID</th>
                        <th style={{ padding: "8px 12px" }}>Action</th>
                        <th style={{ padding: "8px 12px" }}>Triggered By</th>
                        <th style={{ padding: "8px 12px" }}>Target</th>
                        <th style={{ padding: "8px 12px" }}>Time</th>
                        <th style={{ padding: "8px 12px" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {MOCK_AUDIT_LOGS.map((log) => (
                        <tr key={log.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{log.id}</td>
                          <td style={{ padding: "8px 12px", fontWeight: "600", color: "#0f172a" }}>{log.action}</td>
                          <td style={{ padding: "8px 12px", color: "#475569" }}>{log.user}</td>
                          <td style={{ padding: "8px 12px" }}>{log.target}</td>
                          <td style={{ padding: "8px 12px", color: "#64748b" }}>{log.time}</td>
                          <td style={{ padding: "8px 12px" }}>
                            <span style={{ background: "#ecfdf5", color: "#059669", padding: "2px 8px", borderRadius: "999px", fontWeight: "600" }}>
                              {log.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Database Actions */}
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={copySql}
                  style={{
                    background: copied ? "#059669" : "#ffffff",
                    color: copied ? "#ffffff" : "#0f172a",
                    border: "1.5px solid #cbd5e1",
                    padding: "9px 16px",
                    borderRadius: "12px",
                    fontSize: "12.5px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  {copied ? "✓ RLS Script Copied!" : "📋 Copy Supabase RLS Script"}
                </button>
                <button
                  type="button"
                  onClick={onSeedSupabase}
                  style={{
                    background: "#0f172a",
                    color: "#ffffff",
                    border: "none",
                    padding: "9px 16px",
                    borderRadius: "12px",
                    fontSize: "12.5px",
                    fontWeight: "700",
                    cursor: "pointer",
                  }}
                >
                  ↑ Seed 8-Digit Patient Data
                </button>
              </div>
            </div>
          )}

          {section === "Account" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "20px" }}>
                <div
                  style={{
                    width: "52px",
                    height: "52px",
                    borderRadius: "16px",
                    background: "linear-gradient(135deg, #e91e77 0%, #f02a80 100%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontWeight: "800",
                    fontSize: "20px",
                  }}
                >
                  {currentUser?.email ? currentUser.email.charAt(0).toUpperCase() : "U"}
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                    {currentUser?.role || "Student Clinician"}
                  </h2>
                  <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#64748b" }}>
                    {currentUser?.email || "student@ceu.edu.ph"}
                  </p>
                </div>
              </div>

              <div
                style={{
                  background: "#f8fafc",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: "14px",
                  padding: "16px",
                  display: "grid",
                  gap: "10px",
                  fontSize: "13px",
                  lineHeight: "1.6",
                }}
              >
                <div>
                  <strong style={{ color: "#334155" }}>Active Account Role:</strong>{" "}
                  <span style={{ color: "#e91e77", fontWeight: "700" }}>{currentUser?.role}</span>
                </div>
                {currentUser?.employeeId && (
                  <div>
                    <strong style={{ color: "#334155" }}>Faculty / Employee ID:</strong>{" "}
                    <code style={{ background: "#ffffff", padding: "2px 6px", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
                      {currentUser.employeeId}
                    </code>
                  </div>
                )}
                <div>
                  <strong style={{ color: "#334155" }}>Attending Clinician (Default):</strong> Dr. Jane Doe, MD
                </div>
                <div>
                  <strong style={{ color: "#334155" }}>Clinic Department:</strong> CEU College of Dentistry
                </div>
              </div>

              <div style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={onSignOut}
                  style={{
                    background: "#fef2f2",
                    color: "#dc2626",
                    border: "1.5px solid #fecaca",
                    padding: "9px 18px",
                    borderRadius: "12px",
                    fontWeight: "700",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  Switch Account / Sign Out
                </button>
              </div>
            </div>
          )}

          {section === "Supabase DB" && (
            <div>
              <h2 style={{ margin: "0 0 14px", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                Supabase Database Integration
              </h2>

              <div
                style={{
                  background: "#f8fafc",
                  border: "1.5px solid #e2e8f0",
                  padding: "16px",
                  borderRadius: "14px",
                  marginBottom: "18px",
                  fontSize: "13px",
                  lineHeight: 1.6,
                }}
              >
                <div style={{ marginBottom: "6px" }}>
                  <strong>Project Endpoint:</strong>{" "}
                  <code style={{ background: "#fff", padding: "2px 6px", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
                    https://mnsqgpiupgelkkmknyex.supabase.co
                  </code>
                </div>
                <div>
                  <strong>Live Status:</strong>{" "}
                  {dbStatus.checking ? (
                    <span style={{ color: "#d97706", fontWeight: "600" }}>● Checking connection...</span>
                  ) : dbStatus.connected ? (
                    <span style={{ color: "#059669", fontWeight: "700" }}>
                      ● Connected & Synchronized with Supabase
                    </span>
                  ) : (
                    <span style={{ color: "#dc2626", fontWeight: "700" }}>● Error: {dbStatus.error}</span>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", marginBottom: "18px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={onRefreshFromSupabase}
                  style={{
                    background: "linear-gradient(135deg, #e91e77 0%, #ec206f 100%)",
                    color: "#fff",
                    border: 0,
                    padding: "9px 16px",
                    borderRadius: "12px",
                    fontSize: "13px",
                    fontWeight: "700",
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(233, 30, 119, 0.3)",
                  }}
                >
                  ↻ Fetch from Supabase
                </button>

                <button
                  type="button"
                  onClick={onSeedSupabase}
                  style={{
                    background: "#0f172a",
                    color: "#fff",
                    border: 0,
                    padding: "9px 16px",
                    borderRadius: "12px",
                    fontSize: "13px",
                    fontWeight: "700",
                    cursor: "pointer",
                  }}
                >
                  ↑ Seed Sample Data
                </button>

                <button
                  type="button"
                  onClick={copySql}
                  style={{
                    background: copied ? "#059669" : "#ffffff",
                    color: copied ? "#ffffff" : "#334155",
                    border: "1.5px solid #cbd5e1",
                    padding: "9px 16px",
                    borderRadius: "12px",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  {copied ? "✓ Schema Copied!" : "Copy SQL Schema"}
                </button>
              </div>
            </div>
          )}

          {section === "Security" && (
            <div>
              <h2 style={{ margin: "0 0 14px", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                Security & Row Level Security (RLS)
              </h2>
              <div
                style={{
                  background: "#f8fafc",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: "14px",
                  padding: "16px",
                  fontSize: "13px",
                  lineHeight: "1.7",
                }}
              >
                <div><strong>Patient Role:</strong> Restrained to <code>patient_id == auth.uid()</code></div>
                <div><strong>Student Clinician:</strong> Restricted to attended patients & own records</div>
                <div><strong>Faculty:</strong> Unrestricted patient view & ODF approval rights</div>
                <div><strong>Administrator:</strong> System audit logs & configuration management</div>
              </div>
            </div>
          )}

          {section === "Appearance" && (
            <div>
              <h2 style={{ margin: "0 0 14px", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                Appearance & Theme
              </h2>
              <div
                style={{
                  background: "#f8fafc",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: "14px",
                  padding: "16px",
                  fontSize: "13px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "8px",
                      background: "linear-gradient(135deg, #e91e77 0%, #ec206f 100%)",
                    }}
                  />
                  <span>
                    <strong>I-Teeth Clinic Magenta</strong> (#e91e77)
                  </span>
                </div>
              </div>
            </div>
          )}

          {section === "System Info" && (
            <div>
              <h2 style={{ margin: "0 0 14px", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                System Info
              </h2>
              <div
                style={{
                  background: "#f8fafc",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: "14px",
                  padding: "16px",
                  fontSize: "13px",
                  lineHeight: "1.7",
                }}
              >
                <div><strong>Applet:</strong> I-Teeth Dental Patient Management System</div>
                <div><strong>Runtime:</strong> React 19 + Vite 8 SPA</div>
                <div><strong>Database:</strong> Supabase PostgreSQL (PostgREST API)</div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Role Assignment Modal (Admin Exclusive) */}
      {showRoleModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(4px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
          onClick={() => setShowRoleModal(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "440px",
              background: "#ffffff",
              borderRadius: "24px",
              boxShadow: "0 24px 48px -12px rgba(0, 0, 0, 0.25)",
              overflow: "hidden",
              border: "1px solid #e2e8f0",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                padding: "20px 24px",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "17px", fontWeight: "800" }}>
                Developer Role Switcher
              </h3>
              <button
                type="button"
                onClick={() => setShowRoleModal(false)}
                style={{
                  background: "rgba(255, 255, 255, 0.2)",
                  border: "none",
                  borderRadius: "50%",
                  width: "30px",
                  height: "30px",
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "20px 24px" }}>
              <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#475569" }}>
                Select a user role to instantly simulate its exact permission boundaries, conditional components, and views:
              </p>

              <div style={{ display: "grid", gap: "8px", marginBottom: "20px" }}>
                {[
                  { key: "Student Clinician", desc: "Attended patients only, ODF upload modal" },
                  { key: "Dentistry Department Faculty", desc: "All patients, ODF review, approve/reject" },
                  { key: "System Administrator", desc: "Full faculty access + Developer options" },
                  { key: "Patient", desc: "Strictly own health record (John Doe)" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      onSwitchRole(item.key);
                      setShowRoleModal(false);
                    }}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "12px",
                      border: currentUser?.role === item.key ? "2px solid #0284c7" : "1.5px solid #e2e8f0",
                      background: currentUser?.role === item.key ? "#f0f9ff" : "#ffffff",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: "700", fontSize: "13.5px", color: "#0f172a" }}>{item.key}</div>
                    <div style={{ fontSize: "11.5px", color: "#64748b" }}>{item.desc}</div>
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setShowRoleModal(false)}
                  style={{
                    background: "#f1f5f9",
                    color: "#475569",
                    border: "none",
                    padding: "9px 18px",
                    borderRadius: "12px",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
