import { useState, useEffect } from "react";
import Layout from "./Layout";
import { testSupabaseConnection } from "../lib/dentalService";
import { normalizeRole, canAccessDeveloperOptions } from "../lib/roleUtils";

const MOCK_AUDIT_LOGS = [
  { id: "LOG-9941", action: "ODF_SUBMIT", user: "student@ceu.edu.ph", target: "Patient #10000005", time: "10 mins ago", status: "Success" },
  { id: "LOG-9940", action: "FACULTY_APPROVE", user: "faculty@ceu.edu.ph", target: "ODF #10000001", time: "25 mins ago", status: "Success" },
  { id: "LOG-9939", action: "PATIENT_RECORD_VIEW", user: "student@ceu.edu.ph", target: "Patient #10000002", time: "1 hour ago", status: "Authorized" },
  { id: "LOG-9937", action: "AUTH_PROFILE_VERIFY", user: "System Auth", target: "Active Session", time: "3 hours ago", status: "Verified" },
];

export default function Settings({
  onNavigate,
  onSeedSupabase = () => {},
  onRefreshFromSupabase = () => {},
  currentUser,
  onSignOut,
}) {
  const normRole = normalizeRole(currentUser);
  const isAdmin = canAccessDeveloperOptions(normRole);
  const canSeedSupabase = import.meta.env.DEV && currentUser?.role === "System Admin";

  const sections = ["Account"];
  if (isAdmin) {
    sections.push("Developer Options");
  }
  sections.push("Supabase DB", "Security", "Appearance", "System Info");

  const [section, setSection] = useState(isAdmin ? "Developer Options" : "Account");
  const [dbStatus, setDbStatus] = useState({ checking: true, connected: false, error: null });

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

  return (
    <Layout
      active="settings"
      onNavigate={onNavigate}
      currentUser={currentUser}
      onSignOut={onSignOut}
    >
      <div className="page-header-row">
        <h1 className="page-title">Settings</h1>
      </div>

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
                    System audit logs and platform diagnostics
                  </p>
                </div>
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
                    <div style={{ color: "#64748b", fontSize: "11px" }}>Session Authentication</div>
                    <div style={{ color: "#0284c7", fontWeight: "700" }}>● Supabase Auth Active</div>
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

              {/* Development-Only Database Seed Action */}
              {canSeedSupabase && (
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
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
                    ↑ Seed Supabase
                  </button>
                </div>
              )}
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
                  {(currentUser?.name || currentUser?.email || "U").charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                    {currentUser?.name || currentUser?.role || "Authenticated User"}
                  </h2>
                  <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#64748b" }}>
                    {currentUser?.email || ""}
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
                  Sign Out
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
                  <strong>Service Provider:</strong> Supabase PostgreSQL
                </div>
                <div>
                  <strong>Live Status:</strong>{" "}
                  {dbStatus.checking ? (
                    <span style={{ color: "#d97706", fontWeight: "600" }}>● Checking connection...</span>
                  ) : dbStatus.connected && dbStatus.tableFound ? (
                    <span style={{ color: "#059669", fontWeight: "700" }}>
                      ● Connected & Synchronized with Supabase
                    </span>
                  ) : dbStatus.connected ? (
                    <span style={{ color: "#d97706", fontWeight: "700" }}>
                      ● {dbStatus.error || "Limited sync availability"}
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

                {canSeedSupabase && (
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
                    ↑ Seed Supabase
                  </button>
                )}
              </div>
            </div>
          )}

          {section === "Security" && (
            <div>
              <h2 style={{ margin: "0 0 14px", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                Access Control & Permissions
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
                <div><strong>Student Clinician:</strong> Attended patients, ODF submissions, and status tracking</div>
                <div><strong>Faculty:</strong> Full patient records access, ODF review, approval, and record management</div>
                <div><strong>System Admin:</strong> Full clinical management, audit logs, and system configuration</div>
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
                <div><strong>Database:</strong> Supabase PostgreSQL</div>
              </div>
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
