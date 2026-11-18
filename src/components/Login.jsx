import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

function getFriendlySignInError(error) {
  const msg = String(error?.message || "").toLowerCase();
  if (msg.includes("invalid login credentials") || msg.includes("invalid_credentials")) {
    return "Invalid email or password. Please check your credentials and try again.";
  }
  if (msg.includes("email not confirmed")) {
    return "Your account email has not been confirmed yet. Please check your inbox.";
  }
  if (msg.includes("too many requests") || error?.status === 429) {
    return "Too many sign-in attempts. Please wait a moment and try again.";
  }
  if (msg.includes("network") || msg.includes("failed to fetch")) {
    return "Unable to reach the authentication service. Please check your connection.";
  }
  return "Unable to sign in. Please verify your email and password and try again.";
}

export default function Login({ authError = "", onClearError = () => {} }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const displayedError = localError || authError;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedEmail = email.trim();

    setLocalError("");
    onClearError();

    if (!trimmedEmail || !password) {
      setLocalError("Please enter both your email address and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        setLocalError(getFriendlySignInError(error));
      }
    } catch {
      setLocalError("Unable to reach the authentication service. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px 16px",
        background: "#ffbfd7",
        fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif',
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
          {displayedError && (
            <div
              role="alert"
              style={{
                marginBottom: "18px",
                padding: "11px 14px",
                borderRadius: "12px",
                background: "#fef2f2",
                border: "1.5px solid #fecaca",
                color: "#b91c1c",
                fontSize: "12.5px",
                fontWeight: "600",
                lineHeight: "1.45",
              }}
            >
              {displayedError}
            </div>
          )}

          {/* Email Field */}
          <div style={{ marginBottom: "18px" }}>
            <label
              htmlFor="login-email"
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
                id="login-email"
                type="email"
                required
                autoComplete="email"
                disabled={isSubmitting}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (localError) setLocalError("");
                  if (authError) onClearError();
                }}
                placeholder="name@ceu.edu.ph"
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
              htmlFor="login-password"
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
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                disabled={isSubmitting}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (localError) setLocalError("");
                  if (authError) onClearError();
                }}
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
            disabled={isSubmitting}
            style={{
              width: "100%",
              height: "48px",
              background: "linear-gradient(135deg, #e91e77 0%, #ec206f 100%)",
              color: "#ffffff",
              border: "none",
              borderRadius: "14px",
              fontSize: "15px",
              fontWeight: "700",
              cursor: isSubmitting ? "not-allowed" : "pointer",
              opacity: isSubmitting ? 0.75 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              boxShadow: "0 6px 16px rgba(233, 30, 119, 0.35)",
              transition: "transform 0.15s ease, box-shadow 0.15s ease",
            }}
            onMouseEnter={(e) => {
              if (!isSubmitting) {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 8px 20px rgba(233, 30, 119, 0.42)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 6px 16px rgba(233, 30, 119, 0.35)";
            }}
          >
            <span>{isSubmitting ? "Signing In..." : "Sign In"}</span>
            {!isSubmitting && (
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
            )}
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
