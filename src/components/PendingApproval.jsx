import { useState } from "react";
import Layout from "./Layout";
import DigitalOdfForm from "./DigitalOdfForm";
import DocumentViewerModal from "./DocumentViewerModal";
import { normalizeRole, canApproveODF, isStudentClinician } from "../lib/roleUtils";
import { to8DigitId, DEFAULT_CLINICIAN } from "../lib/dentalService";

const MOCK_PENDING = [
  { id: "10000005", name: "Grace Brewster", visitDate: "03/22/2026", clinician: "student@ceu.edu.ph (Student Clinician)", submittedBy: "student@ceu.edu.ph" },
];
const ROWS = 7;

export default function PendingApproval({
  onNavigate,
  pending = MOCK_PENDING,
  onReview = () => {},
  onApprove = () => {},
  onDecline = () => {},
  onAddPending = () => {},
  isSyncing = false,
  currentUser,
  onSignOut,
}) {
  const [query, setQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewingDocTarget, setViewingDocTarget] = useState(null);

  const normRole = normalizeRole(currentUser?.role);
  const allowApprove = canApproveODF(normRole);
  const isStudent = isStudentClinician(normRole);

  const userEmail = (currentUser?.email || "").toLowerCase();
  const userClinicianName = userEmail.split("@")[0].toLowerCase();

  // Role Filtering:
  // Student Clinicians can ONLY view what they submitted
  // Faculty & System Admins can view and approve all submissions
  const roleFiltered = pending.filter((p) => {
    if (isStudent) {
      const subBy = (p.submittedBy || p.clinicianEmail || "").toLowerCase();
      const clin = (p.clinician || "").toLowerCase();
      const isMine =
        (subBy && subBy === userEmail) ||
        (clin && userClinicianName && clin.includes(userClinicianName)) ||
        clin.includes("student@ceu.edu.ph") ||
        to8DigitId(p.id) === "10000005"; // Default student submission
      return isMine;
    }
    return true;
  });

  const filtered = roleFiltered.filter((p) => {
    const formattedId = to8DigitId(p.id);
    return `${formattedId} ${p.name} ${p.clinician || ""}`.toLowerCase().includes(query.toLowerCase());
  });
  const blanks = Math.max(0, ROWS - filtered.length);

  return (
    <Layout
      active="approvals"
      onNavigate={onNavigate}
      currentUser={currentUser}
      onSignOut={onSignOut}
    >
      {/* Role Notice Banner */}
      {isStudent && (
        <div
          style={{
            background: "#fdf2f8",
            border: "1.5px solid #fbcfe8",
            borderRadius: "14px",
            padding: "12px 18px",
            marginBottom: "16px",
            fontSize: "13px",
            color: "#9d174d",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <span>
            📋 <strong>Student Clinician Workspace:</strong> Viewing your submitted ODF requests ({filtered.length} pending). Under department protocol, only Supervising Faculty and System Administrators can approve or decline ODF forms.
          </span>
        </div>
      )}

      {allowApprove && (
        <div
          style={{
            background: "#f0fdf4",
            border: "1.5px solid #bbf7d0",
            borderRadius: "14px",
            padding: "12px 18px",
            marginBottom: "16px",
            fontSize: "13px",
            color: "#166534",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <span>
            ⚡ <strong>Faculty Review Gate:</strong> You have clinical authority to evaluate, review attached physical documents, approve, or request revisions on student ODF submissions.
          </span>
        </div>
      )}

      <div className="toolbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
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
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="pill pill--search"
              placeholder="Search approvals (8-digit ID or name)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <button className="pill" type="button" onClick={() => setQuery("")}>
            {query ? "Clear Filter" : isStudent ? "My Submissions" : "All Submissions"}
          </button>

          <button
            className="pill pill--primary"
            type="button"
            onClick={() => setShowAddModal(true)}
          >
            + New ODF Submission
          </button>
        </div>

        {isSyncing && (
          <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: "#e91e77",
                display: "inline-block",
                animation: "pulse 1.5s infinite",
              }}
            />
            Syncing with Supabase...
          </span>
        )}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Patient / Request ID</th>
              <th>Patient Name</th>
              <th>Visit Date (MM/DD/YYYY)</th>
              <th>Attending Clinician</th>
              <th style={{ textAlign: "right", paddingRight: "20px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const formatted8DigitId = to8DigitId(p.id);
              return (
                <tr key={p.id}>
                  <td style={{ fontFamily: "monospace", fontSize: "13px", fontWeight: "700", color: "#0f172a", letterSpacing: "0.5px" }}>
                    {formatted8DigitId}
                  </td>
                  <td style={{ fontWeight: 600, color: "#1e293b" }}>{p.name}</td>
                  <td>{p.visitDate}</td>
                  <td>{p.clinician || DEFAULT_CLINICIAN}</td>
                  <td style={{ textAlign: "right", paddingRight: "20px" }}>
                    {/* View Document Button - available to ALL roles */}
                    <button
                      className="table__action"
                      style={{ background: "#f8fafc", borderColor: "#cbd5e1", color: "#0f172a", fontWeight: "700" }}
                      onClick={() => setViewingDocTarget(p)}
                      title="Inspect full scanned CEU Oral Diagnosis Form document"
                    >
                      📄 View Doc
                    </button>

                    <button className="table__action" onClick={() => onReview(p)}>
                      {isStudent ? "View Submission" : "Review ODF"}
                    </button>

                    {allowApprove ? (
                      <>
                        <button
                          className="table__action table__action--approve"
                          onClick={() => onApprove(p)}
                          title="Faculty Approval for Treatment"
                        >
                          Approve
                        </button>
                        <button
                          className="table__action table__action--decline"
                          onClick={() => onDecline(p)}
                          title="Decline or Request Revision"
                        >
                          Decline
                        </button>
                      </>
                    ) : (
                      <span
                        style={{
                          fontSize: "11px",
                          color: "#d97706",
                          background: "#fef3c7",
                          padding: "4px 10px",
                          borderRadius: "999px",
                          fontWeight: "700",
                          marginLeft: "4px",
                        }}
                      >
                        ⏳ Awaiting Faculty Sign-Off
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {Array.from({ length: blanks }, (_, i) => (
              <tr key={`blank-${i}`}>
                <td colSpan={5} style={{ height: "46px" }} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Request Modal */}
      {showAddModal && (
        <DigitalOdfForm
          patientId={to8DigitId(pending.length + 10)}
          currentUser={currentUser}
          onCancel={() => setShowAddModal(false)}
          onSave={(odfData) => {
            onAddPending(odfData);
            setShowAddModal(false);
          }}
        />
      )}

      {/* Scanned Document Viewer Modal */}
      {viewingDocTarget && (
        <DocumentViewerModal
          record={viewingDocTarget}
          patient={viewingDocTarget}
          onClose={() => setViewingDocTarget(null)}
        />
      )}
    </Layout>
  );
}
