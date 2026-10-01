import { useState } from "react";
import Layout from "./Layout";
import DigitalOdfForm from "./DigitalOdfForm";
import { normalizeRole, canApproveODF } from "../lib/roleUtils";
import { to8DigitId, DEFAULT_CLINICIAN } from "../lib/dentalService";

const MOCK_PENDING = [
  { id: "10000001", name: "John Doe", visitDate: "01/01/2026", clinician: "Dr. Jane Doe, MD" },
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

  const normRole = normalizeRole(currentUser?.role);
  const allowApprove = canApproveODF(normRole);

  const filtered = pending.filter((p) => {
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

          <button className="pill" type="button">
            Filter by
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
                    <button className="table__action" onClick={() => onReview(p)}>
                      Review ODF
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
                          padding: "3px 8px",
                          borderRadius: "999px",
                          fontWeight: "600",
                        }}
                      >
                        Pending Faculty Sign-off
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
    </Layout>
  );
}
