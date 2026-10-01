import "./Layout.css";
import { normalizeRole, canViewPendingApprovals } from "../lib/roleUtils";

export default function Layout({
  active,
  onNavigate = () => {},
  showHome = true,
  currentUser = { role: "Student Clinician", email: "student@ceu.edu.ph" },
  onSignOut = () => {},
  children,
}) {
  const normRole = normalizeRole(currentUser?.role);

  // Dynamic tab slots based on User Role specifications
  const tabs = [];

  if (normRole === "patient") {
    tabs.push({ key: "patients", label: "My Patient Record" });
    tabs.push({ key: "settings", label: "Settings & Profile" });
  } else {
    tabs.push({ key: "patients", label: "Patients Database" });
    if (canViewPendingApprovals(normRole)) {
      tabs.push({
        key: "approvals",
        label: normRole === "student_clinician" ? "ODF Submissions" : "Pending Approvals",
      });
    }
    tabs.push({ key: "settings", label: "Settings" });
  }

  return (
    <div className="screen">
      {/* Brand Header Banner */}
      <header className="brand-header">
        <div className="brand-header__left">
          <div className="brand-badge-icon" aria-hidden="true">
            <svg
              width="20"
              height="20"
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
          <div>
            <h1 className="brand-title">I-Teeth</h1>
            <p className="brand-subtitle">Patient Management System</p>
          </div>
        </div>

        <div className="brand-header__right">
          <div className="role-pill">
            <span
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: normRole === "admin" ? "#38bdf8" : normRole === "patient" ? "#fbbf24" : "#4ade80",
                display: "inline-block",
              }}
            />
            <span>{currentUser?.role || "Clinician"}</span>
            {currentUser?.employeeId && (
              <span style={{ opacity: 0.85, fontSize: "10.5px" }}>
                ({currentUser.employeeId})
              </span>
            )}
          </div>

          <button
            type="button"
            className="signout-btn"
            onClick={onSignOut}
            title="Sign out or switch role"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Tab Navigation */}
      <nav className="navbar" aria-label="Main Navigation">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`navbar__tab ${active === t.key ? "navbar__tab--active" : ""}`}
            onClick={() => onNavigate(t.key)}
            aria-current={active === t.key ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="screen__body">{children}</main>

      {showHome && (
        <button
          className="home-btn"
          aria-label="Home"
          onClick={() => onNavigate("patients")}
          title="Return to Home"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3z" />
          </svg>
        </button>
      )}
    </div>
  );
}
