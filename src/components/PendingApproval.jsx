import { useState, useMemo } from "react";
import Layout from "./Layout";
import OralDiagnosisForm from "./OralDiagnosisForm";
import { normalizeRole, canApproveODF, isStudentClinician } from "../lib/roleUtils";
import {
  to8DigitId,
  UNASSIGNED_CLINICIAN,
  generateNextPatientId,
  DECLINE_RUBRIC_DOMAINS,
  summarizeOcrConfidence,
} from "../lib/dentalService";

const ROWS = 11;

function createDefaultRubric() {
  return DECLINE_RUBRIC_DOMAINS.reduce((acc, domain) => {
    acc[domain.id] = "pass";
    return acc;
  }, {});
}

function formatReviewedTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function PendingApproval({
  onNavigate,
  pending = [],
  declined = [],
  patients = [],
  onReview = () => {},
  onApprove = () => {},
  onDecline = () => {},
  onAddPending = () => {},
  onRefreshDeclined = null,
  currentUser,
  onSignOut,
}) {
  const [activeTab, setActiveTab] = useState("pending"); // "pending" | "returned"
  const [query, setQuery] = useState("");
  const [filterBy, setFilterBy] = useState("all");
  const [showAddModal, setShowAddModal] = useState(false);

  // Faculty Decline Rubric Modal state
  const [declineTarget, setDeclineTarget] = useState(null);
  const [declineRubric, setDeclineRubric] = useState(createDefaultRubric);
  const [declineComments, setDeclineComments] = useState("");
  const [declineError, setDeclineError] = useState("");
  const [isSubmittingDecline, setIsSubmittingDecline] = useState(false);

  // Student Clinician Revise & Resubmit Modal state
  const [reviseTarget, setReviseTarget] = useState(null);

  const normRole = normalizeRole(currentUser?.role);
  const allowApprove = canApproveODF(normRole);
  const isStudent = isStudentClinician(normRole);

  const userEmail = (currentUser?.email || "").trim().toLowerCase();
  const userClinicianName = userEmail.includes("@")
    ? userEmail.split("@")[0].toLowerCase()
    : "";

  const matchesCurrentStudent = useMemo(() => {
    return (item) => {
      if (!isStudent) return true;
      const subBy = (
        item?.submittedBy ||
        item?.clinicianEmail ||
        item?.odfDetails?.submittedBy ||
        ""
      )
        .trim()
        .toLowerCase();
      const clin = (item?.clinician || "").trim().toLowerCase();
      if (subBy && userEmail) return subBy === userEmail;
      if (userEmail && clin.includes(userEmail)) return true;
      if (userClinicianName && clin.includes(userClinicianName)) return true;
      return false;
    };
  }, [isStudent, userEmail, userClinicianName]);

  const roleFiltered = useMemo(
    () => (Array.isArray(pending) ? pending : []).filter(matchesCurrentStudent),
    [pending, matchesCurrentStudent]
  );

  const roleFilteredDeclined = useMemo(
    () => (Array.isArray(declined) ? declined : []).filter(matchesCurrentStudent),
    [declined, matchesCurrentStudent]
  );

  const activeSourceList = activeTab === "returned" ? roleFilteredDeclined : roleFiltered;

  const clinicianOptions = useMemo(() => {
    const set = new Set();
    activeSourceList.forEach((p) => {
      if (p.clinician) set.add(p.clinician);
    });
    return Array.from(set);
  }, [activeSourceList]);

  const applySearchAndFilter = (sourceList) => {
    const searchLower = query.trim().toLowerCase();
    const list = sourceList.filter((p) => {
      const formattedId = to8DigitId(p.id);
      const matchesSearch =
        !searchLower ||
        `${formattedId} ${p.name || ""} ${p.clinician || ""} ${p.visitDate || ""} ${p.procedure || ""}`
          .toLowerCase()
          .includes(searchLower);

      if (!matchesSearch) return false;
      if (filterBy.startsWith("clinician:")) {
        return (p.clinician || UNASSIGNED_CLINICIAN) === filterBy.slice("clinician:".length);
      }
      return true;
    });

    if (filterBy === "name_az") {
      return [...list].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }
    if (filterBy === "recent") {
      return [...list].sort(
        (a, b) =>
          new Date(b.reviewedAt || b.visitDate || 0) -
          new Date(a.reviewedAt || a.visitDate || 0)
      );
    }
    return list;
  };

  const filtered = useMemo(
    () => applySearchAndFilter(roleFiltered),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roleFiltered, query, filterBy]
  );

  const filteredDeclined = useMemo(
    () => applySearchAndFilter(roleFilteredDeclined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roleFilteredDeclined, query, filterBy]
  );

  // Recurring Revision Insights summary across returned forms
  const recurringInsights = useMemo(() => {
    if (roleFilteredDeclined.length === 0) return [];
    const counts = DECLINE_RUBRIC_DOMAINS.map((domain) => {
      const count = roleFilteredDeclined.reduce((sum, item) => {
        const rubric = item?.reviewFeedback?.rubric || item?.odfDetails?.reviewFeedback?.rubric || {};
        return rubric[domain.id] === "needs_revision" ? sum + 1 : sum;
      }, 0);
      return { ...domain, count };
    })
      .filter((d) => d.count > 0)
      .sort((a, b) => b.count - a.count);
    return counts;
  }, [roleFilteredDeclined]);

  const blanks = Math.max(0, ROWS - filtered.length);

  const handleTabSwitch = (nextTab) => {
    setActiveTab(nextTab);
    setFilterBy("all");
    if (nextTab === "returned" && typeof onRefreshDeclined === "function") {
      onRefreshDeclined();
    }
  };

  const openDeclineModal = (item) => {
    setDeclineTarget(item);
    setDeclineRubric(createDefaultRubric());
    setDeclineComments("");
    setDeclineError("");
  };

  const closeDeclineModal = () => {
    if (isSubmittingDecline) return;
    setDeclineTarget(null);
    setDeclineError("");
  };

  const toggleDomainStatus = (domainId, status) => {
    setDeclineRubric((prev) => ({ ...prev, [domainId]: status }));
    if (declineError) setDeclineError("");
  };

  const handleConfirmDecline = async (e) => {
    e.preventDefault();
    if (!declineTarget || isSubmittingDecline) return;

    const hasFlaggedDomain = DECLINE_RUBRIC_DOMAINS.some(
      (d) => declineRubric[d.id] === "needs_revision"
    );
    const trimmedComments = declineComments.trim();

    if (!hasFlaggedDomain && !trimmedComments) {
      setDeclineError(
        "Mark at least one rubric domain as Needs Revision or enter clinical remarks explaining the required changes."
      );
      return;
    }

    setIsSubmittingDecline(true);
    setDeclineError("");
    try {
      const reviewFeedback = {
        rubric: { ...declineRubric },
        comments: trimmedComments,
        reviewerName: currentUser?.name || currentUser?.email || "Supervising Faculty",
        reviewerId: currentUser?.id || null,
        reviewedAt: new Date().toISOString(),
      };
      const res = await onDecline(declineTarget, reviewFeedback);
      if (res?.success === false) {
        setDeclineError(res.error || "Unable to decline submission. Please try again.");
      } else {
        setDeclineTarget(null);
      }
    } finally {
      setIsSubmittingDecline(false);
    }
  };

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

        <div
          role="tablist"
          aria-label="Submission Status Tabs"
          style={{
            display: "inline-flex",
            background: "rgba(255, 255, 255, 0.72)",
            padding: "4px",
            borderRadius: "14px",
            border: "1px solid rgba(255, 255, 255, 0.9)",
            gap: "4px",
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "pending"}
            onClick={() => handleTabSwitch("pending")}
            style={{
              border: "none",
              borderRadius: "10px",
              padding: "8px 14px",
              fontFamily: "inherit",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              background: activeTab === "pending" ? "#e11d74" : "transparent",
              color: activeTab === "pending" ? "#ffffff" : "#0f172a",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              transition: "all 0.15s ease",
            }}
          >
            <span>Pending Queue</span>
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                fontSize: "11.5px",
                fontWeight: 800,
                padding: "1px 7px",
                borderRadius: "999px",
                background: activeTab === "pending" ? "rgba(255,255,255,0.22)" : "#ffe4ef",
                color: activeTab === "pending" ? "#ffffff" : "#be185d",
              }}
            >
              {roleFiltered.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "returned"}
            onClick={() => handleTabSwitch("returned")}
            style={{
              border: "none",
              borderRadius: "10px",
              padding: "8px 14px",
              fontFamily: "inherit",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              background: activeTab === "returned" ? "#e11d74" : "transparent",
              color: activeTab === "returned" ? "#ffffff" : "#0f172a",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              transition: "all 0.15s ease",
            }}
          >
            <span>Returned / Needs Revision</span>
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                fontSize: "11.5px",
                fontWeight: 800,
                padding: "1px 7px",
                borderRadius: "999px",
                background:
                  activeTab === "returned"
                    ? "rgba(255,255,255,0.22)"
                    : roleFilteredDeclined.length > 0
                    ? "#fef3c7"
                    : "#f1f5f9",
                color:
                  activeTab === "returned"
                    ? "#ffffff"
                    : roleFilteredDeclined.length > 0
                    ? "#b45309"
                    : "#475569",
              }}
            >
              {roleFilteredDeclined.length}
            </span>
          </button>
        </div>
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

      {activeTab === "pending" ? (
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
                  const ocrSummary = summarizeOcrConfidence(p.odfDetails);
                  const hasLowSeverity = ocrSummary.unverifiedFields.some(
                    (f) => f.severity === "low"
                  );
                  return (
                    <tr key={rowKey}>
                      <td className="table__id-cell">{formatted8DigitId}</td>
                      <td style={{ fontWeight: 600 }}>
                        <div>{p.name}</div>
                        {ocrSummary.unverifiedCount > 0 ? (
                          <div style={{ marginTop: "4px" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                fontSize: "11px",
                                fontWeight: 700,
                                fontVariantNumeric: "tabular-nums",
                                padding: "2px 8px",
                                borderRadius: "999px",
                                background: hasLowSeverity ? "#fef2f2" : "#fffbeb",
                                color: hasLowSeverity ? "#b91c1c" : "#b45309",
                                border: `1px solid ${hasLowSeverity ? "#fecaca" : "#fcd34d"}`,
                              }}
                            >
                              ⚠ {ocrSummary.unverifiedCount} Unverified OCR Field
                              {ocrSummary.unverifiedCount > 1 ? "s" : ""}
                            </span>
                          </div>
                        ) : ocrSummary.flaggedCount > 0 ? (
                          <div style={{ marginTop: "4px" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                fontSize: "11px",
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: "999px",
                                background: "#ecfdf5",
                                color: "#047857",
                                border: "1px solid #a7f3d0",
                              }}
                            >
                              ✓ OCR Fields Verified
                            </span>
                          </div>
                        ) : null}
                      </td>
                      <td className="table__date-cell">{p.visitDate}</td>
                      <td>{p.clinician || UNASSIGNED_CLINICIAN}</td>
                      <td className="table__actions-cell">
                        <div className="table__actions-group">
                          {allowApprove ? (
                            <>
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
                                onClick={() => openDeclineModal(p)}
                                title="Decline or Request Revision"
                              >
                                Decline
                              </button>
                            </>
                          ) : (
                            <>
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
      ) : (
        <div style={{ display: "grid", gap: "14px" }}>
          {recurringInsights.length > 0 && (
            <div
              role="region"
              aria-label="Recurring Revision Insights"
              style={{
                background: "#fffbeb",
                border: "1px solid #fcd34d",
                borderRadius: "14px",
                padding: "14px 18px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <strong style={{ fontSize: "13.5px", color: "#92400e" }}>
                  Recurring Revision Insights
                </strong>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#b45309",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  Across {roleFilteredDeclined.length} returned submission
                  {roleFilteredDeclined.length === 1 ? "" : "s"}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {recurringInsights.slice(0, 3).map((insight, idx) => (
                  <span
                    key={insight.id}
                    style={{
                      background: idx === 0 ? "#fef3c7" : "#ffffff",
                      border: "1px solid #f59e0b",
                      color: "#78350f",
                      borderRadius: "8px",
                      padding: "5px 10px",
                      fontSize: "12px",
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {idx === 0 ? "Top Flagged: " : ""}
                    {insight.label} ({insight.count} of {roleFilteredDeclined.length})
                  </span>
                ))}
              </div>
            </div>
          )}

          {filteredDeclined.length === 0 ? (
            <div
              style={{
                background: "#ffffff",
                borderRadius: "14px",
                padding: "36px 24px",
                textAlign: "center",
                color: "#64748b",
                fontWeight: 600,
                fontSize: "14px",
                boxShadow: "0 6px 22px rgba(15, 23, 42, 0.06)",
              }}
            >
              {isStudent
                ? "No returned ODF submissions requiring revision."
                : "No returned ODF submissions match the current filter."}
            </div>
          ) : (
            filteredDeclined.map((item) => {
              const formatted8DigitId = to8DigitId(item.id);
              const cardKey = item.submissionId || `declined-${formatted8DigitId}-${item.visitDate || ""}`;
              const feedback = item.reviewFeedback || item.odfDetails?.reviewFeedback || {};
              const rubric = feedback.rubric || {};
              const flaggedDomains = DECLINE_RUBRIC_DOMAINS.filter(
                (d) => rubric[d.id] === "needs_revision"
              );
              const passedDomains = DECLINE_RUBRIC_DOMAINS.filter(
                (d) => rubric[d.id] === "pass"
              );
              const reviewedLabel = formatReviewedTimestamp(
                feedback.reviewedAt || item.reviewedAt
              );

              return (
                <article
                  key={cardKey}
                  style={{
                    background: "#ffffff",
                    borderRadius: "14px",
                    padding: "18px 22px",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 6px 20px rgba(15, 23, 42, 0.05)",
                    display: "grid",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: "12px",
                      paddingBottom: "10px",
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                        <span
                          style={{
                            fontFamily: '"JetBrains Mono", monospace',
                            fontVariantNumeric: "tabular-nums",
                            fontSize: "12.5px",
                            fontWeight: 700,
                            background: "#f1f5f9",
                            color: "#0f172a",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                          }}
                        >
                          #{formatted8DigitId}
                        </span>
                        <h2 style={{ margin: 0, fontSize: "16.5px", fontWeight: 800, color: "#0f172a" }}>
                          {item.name}
                        </h2>
                        <span
                          style={{
                            fontSize: "11.5px",
                            fontWeight: 700,
                            background: "#fef3c7",
                            color: "#b45309",
                            border: "1px solid #fcd34d",
                            padding: "2px 8px",
                            borderRadius: "6px",
                          }}
                        >
                          Needs Revision
                        </span>
                      </div>
                      <div
                        style={{
                          marginTop: "6px",
                          fontSize: "12.5px",
                          color: "#475569",
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "14px",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        <span>
                          <strong>Visit Date:</strong> {item.visitDate || "—"}
                        </span>
                        <span>
                          <strong>Clinician:</strong> {item.clinician || UNASSIGNED_CLINICIAN}
                        </span>
                        <span>
                          <strong>Procedure:</strong> {item.procedure || "Oral Diagnosis Form (ODF)"}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="table__action table__action--review"
                        onClick={() => onReview(item)}
                      >
                        View Submission
                      </button>
                      <button
                        type="button"
                        className="table__action"
                        style={{
                          background: "#e11d74",
                          borderColor: "#e11d74",
                          color: "#ffffff",
                        }}
                        onClick={() => setReviseTarget(item)}
                      >
                        Revise &amp; Resubmit
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: "8px" }}>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#64748b",
                        fontWeight: 600,
                        display: "flex",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: "8px",
                      }}
                    >
                      <span>
                        Evaluated by:{" "}
                        <strong style={{ color: "#0f172a" }}>
                          {feedback.reviewerName || "Supervising Faculty"}
                        </strong>
                      </span>
                      {reviewedLabel && (
                        <span style={{ fontVariantNumeric: "tabular-nums" }}>{reviewedLabel}</span>
                      )}
                    </div>

                    {(flaggedDomains.length > 0 || passedDomains.length > 0) && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {flaggedDomains.map((d) => (
                          <span
                            key={d.id}
                            style={{
                              fontSize: "11.5px",
                              fontWeight: 700,
                              background: "#fef2f2",
                              color: "#b91c1c",
                              border: "1px solid #fecaca",
                              borderRadius: "6px",
                              padding: "4px 9px",
                            }}
                          >
                            Needs Revision: {d.label}
                          </span>
                        ))}
                        {passedDomains.map((d) => (
                          <span
                            key={d.id}
                            style={{
                              fontSize: "11.5px",
                              fontWeight: 600,
                              background: "#ecfdf5",
                              color: "#047857",
                              border: "1px solid #a7f3d0",
                              borderRadius: "6px",
                              padding: "4px 9px",
                            }}
                          >
                            Pass: {d.label}
                          </span>
                        ))}
                      </div>
                    )}

                    <div
                      style={{
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                        padding: "10px 14px",
                        fontSize: "13px",
                        color: "#1e293b",
                        lineHeight: 1.5,
                      }}
                    >
                      <strong style={{ color: "#0f172a" }}>Clinical Remarks: </strong>
                      {feedback.comments || "No additional remarks provided."}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      )}

      {/* Faculty Evaluation & Decline Rubric Modal */}
      {declineTarget && (
        <div
          className="confirm-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Faculty Evaluation & Decline Rubric"
          onClick={closeDeclineModal}
        >
          <div
            className="confirm-modal-card"
            style={{ maxWidth: "580px", borderColor: "#fbcfe8" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="confirm-modal-header"
              style={{
                background: "linear-gradient(135deg, #e11d74 0%, #be185d 100%)",
              }}
            >
              <div>
                <h3 className="confirm-modal-title">
                  Faculty Evaluation &amp; Decline Rubric
                </h3>
                <div style={{ fontSize: "12px", opacity: 0.92, marginTop: "2px", fontVariantNumeric: "tabular-nums" }}>
                  Patient #{to8DigitId(declineTarget.id)} — {declineTarget.name}
                </div>
              </div>
              <button
                type="button"
                className="confirm-modal-close"
                onClick={closeDeclineModal}
                aria-label="Close evaluation rubric modal"
              >
                ✕
              </button>
            </div>

            <form className="confirm-modal-body" onSubmit={handleConfirmDecline}>
              <p className="confirm-modal-text" style={{ marginBottom: "14px" }}>
                Evaluate each ODF domain and provide clear revision instructions for the student clinician before returning this submission.
              </p>

              <div style={{ display: "grid", gap: "8px", marginBottom: "16px" }}>
                {DECLINE_RUBRIC_DOMAINS.map((domain) => {
                  const status = declineRubric[domain.id] || "pass";
                  const isPass = status === "pass";
                  const isRevision = status === "needs_revision";
                  return (
                    <div
                      key={domain.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                        padding: "9px 12px",
                        borderRadius: "10px",
                        border: `1px solid ${isRevision ? "#fecaca" : "#e2e8f0"}`,
                        background: isRevision ? "#fef2f2" : "#f8fafc",
                      }}
                    >
                      <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#0f172a" }}>
                        {domain.label}
                      </span>

                      <div
                        style={{
                          display: "inline-flex",
                          gap: "6px",
                          flexShrink: 0,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleDomainStatus(domain.id, "pass")}
                          aria-pressed={isPass}
                          style={{
                            padding: "5px 11px",
                            borderRadius: "8px",
                            fontFamily: "inherit",
                            fontSize: "12px",
                            fontWeight: 700,
                            cursor: "pointer",
                            border: `1px solid ${isPass ? "#059669" : "#cbd5e1"}`,
                            background: isPass ? "#059669" : "#ffffff",
                            color: isPass ? "#ffffff" : "#475569",
                          }}
                        >
                          Pass
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleDomainStatus(domain.id, "needs_revision")}
                          aria-pressed={isRevision}
                          style={{
                            padding: "5px 11px",
                            borderRadius: "8px",
                            fontFamily: "inherit",
                            fontSize: "12px",
                            fontWeight: 700,
                            cursor: "pointer",
                            border: `1px solid ${isRevision ? "#dc2626" : "#cbd5e1"}`,
                            background: isRevision ? "#dc2626" : "#ffffff",
                            color: isRevision ? "#ffffff" : "#475569",
                          }}
                        >
                          Needs Revision
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginBottom: "14px" }}>
                <label
                  htmlFor="faculty-decline-comments"
                  style={{
                    display: "block",
                    fontSize: "12.5px",
                    fontWeight: 700,
                    color: "#0f172a",
                    marginBottom: "6px",
                  }}
                >
                  Clinical Remarks / Revision Instructions
                </label>
                <textarea
                  id="faculty-decline-comments"
                  rows={3}
                  value={declineComments}
                  onChange={(e) => {
                    setDeclineComments(e.target.value);
                    if (declineError) setDeclineError("");
                  }}
                  placeholder="Specify missing charting codes, incomplete history items, or consent corrections required..."
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #cbd5e1",
                    fontFamily: "inherit",
                    fontSize: "13px",
                    color: "#0f172a",
                    resize: "vertical",
                    outline: "none",
                  }}
                />
              </div>

              {declineError && (
                <div
                  role="alert"
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    color: "#b91c1c",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    marginBottom: "14px",
                  }}
                >
                  {declineError}
                </div>
              )}

              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="pill"
                  onClick={closeDeclineModal}
                  disabled={isSubmittingDecline}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="pill pill--danger"
                  disabled={isSubmittingDecline}
                >
                  {isSubmittingDecline ? "Returning..." : "Return for Revision"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add New ODF Submission Modal */}
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

      {/* Student Clinician Revise & Resubmit Modal */}
      {reviseTarget && (
        <OralDiagnosisForm
          key={`revise-${reviseTarget.submissionId || to8DigitId(reviseTarget.eightDigitId || reviseTarget.id)}`}
          patientId={to8DigitId(reviseTarget.eightDigitId || reviseTarget.id)}
          patients={patients}
          pending={pending}
          initialData={{
            ...(reviseTarget.odfDetails || {}),
            eightDigitId: to8DigitId(reviseTarget.eightDigitId || reviseTarget.id),
            name: reviseTarget.name || reviseTarget.odfDetails?.name || "",
            visitDate: reviseTarget.visitDate || reviseTarget.odfDetails?.visitDate || "",
            clinician: reviseTarget.clinician || reviseTarget.odfDetails?.clinician || "",
            reviewFeedback:
              reviseTarget.reviewFeedback || reviseTarget.odfDetails?.reviewFeedback || null,
          }}
          revisionFeedback={
            reviseTarget.reviewFeedback || reviseTarget.odfDetails?.reviewFeedback || null
          }
          currentUser={currentUser}
          onCancel={() => setReviseTarget(null)}
          onSave={async (odfData) => {
            const res = await onAddPending(odfData);
            if (res?.success !== false) {
              setReviseTarget(null);
            }
          }}
        />
      )}
    </Layout>
  );
}
