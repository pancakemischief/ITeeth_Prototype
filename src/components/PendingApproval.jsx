import { useState, useMemo } from "react";
import Layout from "./Layout";
import OralDiagnosisForm from "./OralDiagnosisForm";
import { normalizeRole, canApproveODF, isStudentClinician } from "../lib/roleUtils";
import { to8DigitId, DEFAULT_CLINICIAN, generateNextPatientId } from "../lib/dentalService";

const MOCK_PENDING = [
  {
    id: "10000005",
    name: "Grace Brewster",
    visitDate: "03/22/2026",
    clinician: "student@ceu.edu.ph (Student Clinician)",
    submittedBy: "student@ceu.edu.ph",
  },
];
const ROWS = 11;

export default function PendingApproval({
  onNavigate,
  pending = MOCK_PENDING,
  patients = [],
  onReview = () => {},
  onApprove = () => {},
  onDecline = () => {},
  onAddPending = () => {},
  currentUser,
  onSignOut,
}) {
  const [query, setQuery] = useState("");
  const [filterBy, setFilterBy] = useState("all");
  const [showAddModal, setShowAddModal] = useState(false);

  const normRole = normalizeRole(currentUser?.role);
  const allowApprove = canApproveODF(normRole);
  const isStudent = isStudentClinician(normRole);

  const userEmail = (currentUser?.email || "").toLowerCase();
  const userClinicianName = userEmail.split("@")[0].toLowerCase();

  // Role Filtering:
  // Student Clinicians view what they submitted
  // Faculty & System Admins view and approve all submissions
  const roleFiltered = useMemo(() => {
    return pending.filter((p) => {
      if (isStudent) {
        const subBy = (p.submittedBy || p.clinicianEmail || "").toLowerCase();
        const clin = (p.clinician || "").toLowerCase();
        const isMine =
          (subBy && subBy === userEmail) ||
          (clin && userClinicianName && clin.includes(userClinicianName)) ||
          clin.includes("student@ceu.edu.ph") ||
          to8DigitId(p.id) === "10000005";
        return isMine;
      }
      return true;
    });
  }, [pending, isStudent, userEmail, userClinicianName]);

  const clinicianOptions = useMemo(() => {
    const set = new Set();
    roleFiltered.forEach((p) => {
      if (p.clinician) set.add(p.clinician);
    });
    return Array.from(set);
  }, [roleFiltered]);

  const filtered = useMemo(() => {
    const searchLower = query.trim().toLowerCase();
    const list = roleFiltered.filter((p) => {
      const formattedId = to8DigitId(p.id);
      const matchesSearch =
        !searchLower ||
        `${formattedId} ${p.name} ${p.clinician || ""} ${p.visitDate || ""}`
          .toLowerCase()
          .includes(searchLower);

      if (!matchesSearch) return false;
      if (filterBy.startsWith("clinician:")) {
        return (p.clinician || DEFAULT_CLINICIAN) === filterBy.slice("clinician:".length);
      }
      return true;
    });

    if (filterBy === "name_az") {
      return [...list].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }
    if (filterBy === "recent") {
      return [...list].sort((a, b) => new Date(b.visitDate || 0) - new Date(a.visitDate || 0));
    }
    return list;
  }, [roleFiltered, query, filterBy]);

  const blanks = Math.max(0, ROWS - filtered.length);

  return (
    <Layout
      active="approvals"
      onNavigate={onNavigate}
      currentUser={currentUser}
      onSignOut={onSignOut}
    >
      <div className="page-header-row">
        <h1 className="page-title">
          {isStudent ? "ODF Submissions" : "Pending Approvals"}
        </h1>
      </div>

      <div className="toolbar">
        <div className="toolbar__left">
          <div className="search-input-wrapper">
            <svg
              className="search-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="pill pill--search"
              placeholder="Search Patients"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search Patients"
            />
          </div>

          <div className="filter-select-wrap">
            <select
              className="filter-select"
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value)}
              aria-label="Filter by"
            >
              <option value="all">Filter by</option>
              <option value="recent">Most Recent Visit</option>
              <option value="name_az">Name (A – Z)</option>
              {clinicianOptions.map((clin) => (
                <option key={clin} value={`clinician:${clin}`}>
                  Clinician: {clin}
                </option>
              ))}
            </select>
            <svg
              className="filter-select-chevron"
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
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        <div className="toolbar__right">
          <button
            className="pill pill--primary"
            type="button"
            onClick={() => setShowAddModal(true)}
          >
            + New ODF Submission
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Patient ID</th>
                <th>Name</th>
                <th>Last Visit (MM/DD/YYYY)</th>
                <th>Attending Clinician</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const formatted8DigitId = to8DigitId(p.id);
                const rowKey = p.submissionId || `${formatted8DigitId}-${p.visitDate || ""}`;
                return (
                  <tr key={rowKey}>
                    <td className="table__id-cell">{formatted8DigitId}</td>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td className="table__date-cell">{p.visitDate}</td>
                    <td>{p.clinician || DEFAULT_CLINICIAN}</td>
                    <td className="table__actions-cell">
                      <div className="table__actions-group">
                        {allowApprove ? (
                          <>
                            {/* Faculty & System Admin: "Review Submission" opens the submitted digital record + uploaded images */}
                            <button
                              type="button"
                              className="table__action table__action--review"
                              onClick={() => onReview(p)}
                              title="Review submitted digital CEU Oral Diagnosis Form & uploaded scans"
                            >
                              Review Submission
                            </button>
                            <button
                              type="button"
                              className="table__action table__action--approve"
                              onClick={() => onApprove(p)}
                              title="Faculty Approval for Treatment"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="table__action table__action--decline"
                              onClick={() => onDecline(p)}
                              title="Decline or Request Revision"
                            >
                              Decline
                            </button>
                          </>
                        ) : (
                          <>
                            {/* Student Clinician: "View Doc" removed, keep View Submission + awaiting status */}
                            <button
                              type="button"
                              className="table__action table__action--review"
                              onClick={() => onReview(p)}
                            >
                              View Submission
                            </button>
                            <span className="status-awaiting-text">
                              Awaiting Faculty Sign-Off
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "26px", color: "#64748b", fontWeight: 600 }}>
                    {isStudent ? "No ODF submissions pending faculty sign-off." : "No pending ODF approvals."}
                  </td>
                </tr>
              )}

              {Array.from({ length: blanks }, (_, i) => (
                <tr key={`blank-${i}`}>
                  <td colSpan={5} style={{ height: "42px" }} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add ODF Submission Modal */}
      {showAddModal && (
        <OralDiagnosisForm
          patientId={generateNextPatientId(patients, pending)}
          patients={patients}
          pending={pending}
          currentUser={currentUser}
          onCancel={() => setShowAddModal(false)}
          onSave={(odfData) => {
            onAddPending(odfData);
            setShowAddModal(false);
          }}
        />
      )}
    </Layout>
  );
}
