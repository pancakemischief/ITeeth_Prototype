import { useState } from "react";

const ROLES = [
  "Student Clinician",
  "Dentistry Department Faculty",
  "System Administrator",
  "Patient",
];

export default function Login({ onLogin = () => {} }) {
  const [role, setRole] = useState("Student Clinician");
  const [email, setEmail] = useState("student@ceu.edu.ph");
  const [password, setPassword] = useState("••••••••");
  const [employeeId, setEmployeeId] = useState("FAC-2026-042");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const isEmployee =
    role === "Dentistry Department Faculty" || role === "System Administrator";

  const handleRoleChange = (newRole) => {
    setRole(newRole);
    setIsDropdownOpen(false);

    // Auto-update sample placeholders to be helpful
    if (newRole === "Student Clinician") {
      setEmail("student@ceu.edu.ph");
    } else if (newRole === "Dentistry Department Faculty") {
      setEmail("faculty@ceu.edu.ph");
      setEmployeeId("FAC-2026-042");
    } else if (newRole === "System Administrator") {
      setEmail("admin@ceu.edu.ph");
      setEmployeeId("ADM-2026-001");
    } else if (newRole === "Patient") {
      setEmail("patient.johndoe@gmail.com");
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onLogin({
      role,
      email,
      employeeId: isEmployee ? employeeId : null,
    });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px 16px",
        background: "linear-gradient(135deg, #f8fafc 0%, #edf2f7 50%, #fce7f3 100%)",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "380px",
          background: "#ffffff",
          borderRadius: "24px",
          boxShadow:
            "0 20px 45px -10px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(233, 30, 119, 0.08)",
          overflow: "hidden",
          border: "1px solid rgba(226, 232, 240, 0.8)",
        }}
      >
        {/* Pink Header */}
        <div
          style={{
            background: "linear-gradient(145deg, #e91e77 0%, #f02a80 100%)",
            padding: "32px 24px 28px",
            textAlign: "center",
            color: "#ffffff",
          }}
        >
          {/* Medical Briefcase Icon Badge */}
          <div
            style={{
              width: "52px",
              height: "52px",
              margin: "0 auto 14px",
              borderRadius: "14px",
              background: "rgba(255, 255, 255, 0.22)",
              border: "1.5px solid rgba(255, 255, 255, 0.4)",
              backdropFilter: "blur(4px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
            }}
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="7" width="18" height="13" rx="2" />
              <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="12" y1="11" x2="12" y2="15" />
              <line x1="10" y1="13" x2="14" y2="13" />
            </svg>
          </div>

          <h1
            style={{
              margin: "0 0 4px",
              fontSize: "23px",
              fontWeight: "800",
              letterSpacing: "-0.5px",
              color: "#ffffff",
            }}
          >
            I-Teeth
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "12.5px",
              fontWeight: "500",
              color: "rgba(255, 255, 255, 0.9)",
              letterSpacing: "0.2px",
            }}
          >
            Patient Management System
          </p>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: "26px 24px 28px" }}>
          {/* Account Role Dropdown */}
          <div style={{ marginBottom: "18px", position: "relative" }}>
            <label
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: "700",
                color: "#334155",
                letterSpacing: "0.6px",
                textTransform: "uppercase",
                marginBottom: "6px",
              }}
            >
              Account Role
            </label>

            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              style={{
                width: "100%",
                height: "46px",
                padding: "0 16px",
                background: "#f8fafc",
                border: "2px solid #e91e77",
                borderRadius: "14px",
                fontSize: "13.5px",
                fontWeight: "500",
                color: "#0f172a",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                outline: "none",
                textAlign: "left",
                boxShadow: isDropdownOpen
                  ? "0 0 0 3px rgba(233, 30, 119, 0.2)"
                  : "none",
                transition: "all 0.2s ease",
              }}
              aria-haspopup="listbox"
              aria-expanded={isDropdownOpen}
            >
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {role}
              </span>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#64748b"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: isDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                  flexShrink: 0,
                  marginLeft: "8px",
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {/* Custom Dropdown Menu */}
            {isDropdownOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  left: 0,
                  right: 0,
                  background: "#ffffff",
                  borderRadius: "14px",
                  border: "1.5px solid #e2e8f0",
                  boxShadow: "0 12px 28px -4px rgba(0, 0, 0, 0.15)",
                  zIndex: 50,
                  overflow: "hidden",
                  padding: "4px",
                }}
              >
                {ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => handleRoleChange(r)}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      textAlign: "left",
                      background: r === role ? "#fdf2f8" : "transparent",
                      color: r === role ? "#e91e77" : "#1e293b",
                      fontWeight: r === role ? "700" : "500",
                      fontSize: "13px",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      transition: "background 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      if (r !== role) e.currentTarget.style.background = "#f8fafc";
                    }}
                    onMouseLeave={(e) => {
                      if (r !== role) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <span>{r}</span>
                    {r === role && (
                      <span style={{ color: "#e91e77", fontWeight: "700" }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Employee ID (Only for Faculty & System Administrator) */}
          {isEmployee && (
            <div style={{ marginBottom: "18px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "11px",
                  fontWeight: "700",
                  color: "#334155",
                  letterSpacing: "0.6px",
                  textTransform: "uppercase",
                  marginBottom: "6px",
                }}
              >
                Employee ID
              </label>
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    left: "14px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#94a3b8",
                    display: "flex",
                    alignItems: "center",
                    pointerEvents: "none",
                  }}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <circle cx="9" cy="10" r="2" />
                    <line x1="15" y1="8" x2="17" y2="8" />
                    <line x1="15" y1="12" x2="17" y2="12" />
                    <line x1="7" y1="16" x2="17" y2="16" />
                  </svg>
                </div>
                <input
                  type="text"
                  required
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  placeholder="e.g. FAC-2026-042"
                  style={{
                    width: "100%",
                    height: "46px",
                    padding: "0 14px 0 42px",
                    background: "#f8fafc",
                    border: "1.5px solid #cbd5e1",
                    borderRadius: "14px",
                    fontSize: "13.5px",
                    color: "#0f172a",
                    outline: "none",
                    transition: "all 0.2s ease",
                  }}
                  onFocus={(e) => (e.target.style.borderColor = "#e91e77")}
                  onBlur={(e) => (e.target.style.borderColor = "#cbd5e1")}
                />
              </div>
            </div>
          )}

          {/* Email Field */}
          <div style={{ marginBottom: "18px" }}>
            <label
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: "700",
                color: "#334155",
                letterSpacing: "0.6px",
                textTransform: "uppercase",
                marginBottom: "6px",
              }}
            >
              CEU Institutional Email
            </label>
            <div style={{ position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  left: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#94a3b8",
                  display: "flex",
                  alignItems: "center",
                  pointerEvents: "none",
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              </div>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@ceu.edu.ph"
                style={{
                  width: "100%",
                  height: "46px",
                  padding: "0 14px 0 42px",
                  background: "#f8fafc",
                  border: "1.5px solid #cbd5e1",
                  borderRadius: "14px",
                  fontSize: "13.5px",
                  color: "#0f172a",
                  outline: "none",
                  transition: "all 0.2s ease",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#e91e77")}
                onBlur={(e) => (e.target.style.borderColor = "#cbd5e1")}
              />
            </div>
          </div>

          {/* Password Field */}
          <div style={{ marginBottom: "22px" }}>
            <label
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: "700",
                color: "#334155",
                letterSpacing: "0.6px",
                textTransform: "uppercase",
                marginBottom: "6px",
              }}
            >
              Password
            </label>
            <div style={{ position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  left: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#94a3b8",
                  display: "flex",
                  alignItems: "center",
                  pointerEvents: "none",
                }}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: "100%",
                  height: "46px",
                  padding: "0 14px 0 42px",
                  background: "#f8fafc",
                  border: "1.5px solid #cbd5e1",
                  borderRadius: "14px",
                  fontSize: "14px",
                  color: "#0f172a",
                  outline: "none",
                  transition: "all 0.2s ease",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#e91e77")}
                onBlur={(e) => (e.target.style.borderColor = "#cbd5e1")}
              />
            </div>
          </div>

          {/* Submit Sign In Button */}
          <button
            type="submit"
            style={{
              width: "100%",
              height: "48px",
              background: "linear-gradient(135deg, #e91e77 0%, #ec206f 100%)",
              color: "#ffffff",
              border: "none",
              borderRadius: "14px",
              fontSize: "15px",
              fontWeight: "700",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              boxShadow: "0 6px 16px rgba(233, 30, 119, 0.35)",
              transition: "transform 0.15s ease, box-shadow 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "0 8px 20px rgba(233, 30, 119, 0.42)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 6px 16px rgba(233, 30, 119, 0.35)";
            }}
          >
            <span>Sign In</span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
          </button>

          {/* Protected Portal Footer */}
          <div
            style={{
              marginTop: "22px",
              textAlign: "center",
              fontSize: "11px",
              color: "#94a3b8",
              fontWeight: "500",
              letterSpacing: "0.2px",
            }}
          >
            Protected Portal • Escolar Dental Records System
          </div>
        </form>
      </div>
    </div>
  );
}
