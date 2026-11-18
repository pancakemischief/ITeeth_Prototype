import "./Layout.css";
import { normalizeRole, canViewPendingApprovals } from "../lib/roleUtils";

function formatAccountName(user) {
  if (user?.name) return user.name;
  const email = user?.email || "";
  if (!email) return "Account Name";
  const local = email.split("@")[0];
  if (local === "student") return "Jane Doe (Student)";
  if (local === "faculty") return "Dr. Jane Doe";
  if (local === "admin") return "System Admin";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getInitials(name, email) {
  const source = name || email || "U";
  const parts = source.replace(/[^a-zA-Z\s]/g, " ").trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export default function Layout({
  active,
  onNavigate = () => {},
  currentUser = { role: "Student Clinician", email: "student@ceu.edu.ph" },
  onSignOut = () => {},
  children,
}) {
  const normRole = normalizeRole(currentUser?.role);

  const tabs = [];
  if (normRole === "patient") {
    tabs.push({ key: "patients", label: "My Patient Record" });
    tabs.push({ key: "settings", label: "Settings & Profile" });
  } else {
    tabs.push({ key: "patients", label: "Patient Records" });
    if (canViewPendingApprovals(normRole)) {
      tabs.push({
        key: "approvals",
        label: normRole === "student_clinician" ? "ODF Submissions" : "Pending Approvals",
      });
      tabs.push({ key: "requirements", label: "Requirements" });
    }
    tabs.push({ key: "settings", label: "Settings" });
  }

  const displayName = formatAccountName(currentUser);
  const displayRole = currentUser?.role || "Clinician";
  const initials = getInitials(currentUser?.name, currentUser?.email);

  return (
    <div className="iteeth-shell">
      {/* Left Pink Sidebar */}
      <aside className="iteeth-sidebar" aria-label="Primary Navigation">
        <div className="iteeth-sidebar__top">
          <div className="iteeth-sidebar__brand">
            <div className="iteeth-sidebar__brand-title">I-Teeth</div>
            <div className="iteeth-sidebar__brand-sub">EDR for CEU</div>
          </div>

          <nav className="iteeth-sidebar__nav">
            {tabs.map((t) => {
              const isActive = active === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  className={`iteeth-sidebar__tab ${isActive ? "iteeth-sidebar__tab--active" : ""}`}
                  onClick={() => onNavigate(t.key)}
                  aria-current={isActive ? "page" : undefined}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom User Profile Area */}
        <div className="iteeth-sidebar__footer">
          <div className="iteeth-sidebar__user">
            <div className="iteeth-sidebar__avatar" aria-hidden="true">
              {initials}
            </div>
            <div className="iteeth-sidebar__user-meta">
              <div className="iteeth-sidebar__user-name" title={currentUser?.email || displayName}>
                {displayName}
              </div>
              <div className="iteeth-sidebar__user-role" title={displayRole}>
                {displayRole}
              </div>
              {currentUser?.employeeId && (
                <div className="iteeth-sidebar__user-id">{currentUser.employeeId}</div>
              )}
            </div>
          </div>

          <button
            type="button"
            className="iteeth-sidebar__signout"
            onClick={onSignOut}
            title="Sign out or switch account"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Canvas */}
      <main className="iteeth-main">
        <div className="iteeth-main__inner">{children}</div>
      </main>
    </div>
  );
}
