import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Layout from "./Layout";
import { normalizeRole, canApproveODF } from "../lib/roleUtils";
import { fetchClinicalRequirementsData, to8DigitId } from "../lib/dentalService";

const CLINIC_LEVELS = ["Clinic I", "Clinic II", "Clinic III", "Clinic IV"];

function normalizeClinicLevel(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return "Clinic I";
  if (s === "4" || s.includes("iv") || s.includes("clinic 4") || s.includes("level 4")) {
    return "Clinic IV";
  }
  if (s === "3" || s.includes("iii") || s.includes("clinic 3") || s.includes("level 3")) {
    return "Clinic III";
  }
  if (s === "2" || s.includes("ii") || s.includes("clinic 2") || s.includes("level 2")) {
    return "Clinic II";
  }
  return "Clinic I";
}

function getRequiredCount(reqRow) {
  const val = Number(
    reqRow?.required_count ?? reqRow?.target_count ?? reqRow?.min_count ?? 0
  );
  return Number.isFinite(val) && val > 0 ? val : 0;
}

function getCreditValue(creditRow) {
  const val = Number(
    creditRow?.credit_value ?? creditRow?.credits ?? creditRow?.count ?? 1
  );
  return Number.isFinite(val) && val > 0 ? val : 1;
}

function formatCreditDate(creditRow) {
  const raw =
    creditRow?.visit_date || creditRow?.credited_at || creditRow?.created_at || "";
  if (!raw) return "—";
  const str = String(raw).trim();
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1]}`;
  }
  const slashMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[1].padStart(2, "0")}/${slashMatch[2].padStart(2, "0")}/${slashMatch[3]}`;
  }
  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    }).format(d);
  }
  return str;
}

function escapeCsvCell(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default function ClinicalRequirements({
  onNavigate,
  currentUser,
  onSignOut,
}) {
  const normRole = normalizeRole(currentUser?.role);
  const isFacultyOrAdmin = canApproveODF(normRole);

  const [selectedLevel, setSelectedLevel] = useState("Clinic I");
  const hasManualLevelChoiceRef = useRef(false);
  const [requirements, setRequirements] = useState([]);
  const [credits, setCredits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [cohortSearch, setCohortSearch] = useState("");
  const [selectedStudentEmail, setSelectedStudentEmail] = useState(null);
  const [showAllStudentCredits, setShowAllStudentCredits] = useState(false);

  const applyRequirementsPayload = useCallback(
    (res) => {
      if (!res.success) {
        setErrorMsg(res.error || "Unable to load clinical requirements data.");
      } else {
        setErrorMsg("");
      }
      const reqList = Array.isArray(res.requirements) ? res.requirements : [];
      const credList = Array.isArray(res.credits) ? res.credits : [];
      setRequirements(reqList);
      setCredits(credList);

      if (!hasManualLevelChoiceRef.current && !isFacultyOrAdmin && credList.length > 0) {
        const detected = normalizeClinicLevel(credList[0]?.clinic_level);
        setSelectedLevel(detected);
      }
      setLoading(false);
    },
    [isFacultyOrAdmin]
  );

  useEffect(() => {
    let active = true;
    fetchClinicalRequirementsData(currentUser?.email || null, isFacultyOrAdmin).then((res) => {
      if (active) {
        applyRequirementsPayload(res);
      }
    });
    return () => {
      active = false;
    };
  }, [currentUser?.email, isFacultyOrAdmin, applyRequirementsPayload]);

  const handleRefresh = async () => {
    setLoading(true);
    setErrorMsg("");
    const res = await fetchClinicalRequirementsData(
      currentUser?.email || null,
      isFacultyOrAdmin
    );
    applyRequirementsPayload(res);
  };

  const handleLevelChange = (nextLevel) => {
    hasManualLevelChoiceRef.current = true;
    setSelectedLevel(nextLevel);
    setSelectedStudentEmail(null);
  };

  // Requirement categories for the selected Clinic Level
  const levelCategories = useMemo(() => {
    const map = new Map();
    requirements
      .filter((r) => normalizeClinicLevel(r.clinic_level) === selectedLevel)
      .forEach((r) => {
        const category = String(r.procedure_category || "General Procedure").trim();
        const existing = map.get(category);
        const reqCount = getRequiredCount(r);
        if (existing) {
          existing.required += reqCount;
        } else {
          map.set(category, {
            category,
            required: reqCount,
            description: r.description || "",
          });
        }
      });

    // Also include any credit categories logged at this level not yet in requirements table
    credits
      .filter((c) => normalizeClinicLevel(c.clinic_level) === selectedLevel)
      .forEach((c) => {
        const category = String(c.procedure_category || "General Procedure").trim();
        if (!map.has(category)) {
          map.set(category, {
            category,
            required: 0,
            description: "",
          });
        }
      });

    return Array.from(map.values()).sort((a, b) =>
      a.category.localeCompare(b.category)
    );
  }, [requirements, credits, selectedLevel]);

  // Student Clinician: Progress computed for selected Clinic Level
  const studentProgress = useMemo(() => {
    if (isFacultyOrAdmin) {
      return { categories: [], totalEarned: 0, totalRequired: 0, overallPct: 0 };
    }

    const levelCredits = credits.filter(
      (c) => normalizeClinicLevel(c.clinic_level) === selectedLevel
    );

    const earnedByCategory = new Map();
    levelCredits.forEach((c) => {
      const cat = String(c.procedure_category || "General Procedure").trim();
      earnedByCategory.set(cat, (earnedByCategory.get(cat) || 0) + getCreditValue(c));
    });

    const categories = levelCategories.map((cat) => {
      const earned = earnedByCategory.get(cat.category) || 0;
      const required = cat.required;
      const cappedEarned = required > 0 ? Math.min(earned, required) : earned;
      const pct = required > 0 ? Math.min(100, Math.round((earned / required) * 100)) : earned > 0 ? 100 : 0;
      return {
        ...cat,
        earned,
        cappedEarned,
        pct,
      };
    });

    const totalRequired = categories.reduce((sum, c) => sum + c.required, 0);
    const totalCappedEarned = categories.reduce((sum, c) => sum + c.cappedEarned, 0);
    const totalRawEarned = categories.reduce((sum, c) => sum + c.earned, 0);
    const overallPct =
      totalRequired > 0
        ? Math.min(100, Math.round((totalCappedEarned / totalRequired) * 100))
        : totalRawEarned > 0
        ? 100
        : 0;

    return {
      categories,
      totalEarned: totalRawEarned,
      totalCappedEarned,
      totalRequired,
      overallPct,
    };
  }, [isFacultyOrAdmin, credits, selectedLevel, levelCategories]);

  const studentDisplayedCredits = useMemo(() => {
    if (isFacultyOrAdmin) return [];
    if (showAllStudentCredits) return credits;
    return credits.filter(
      (c) => normalizeClinicLevel(c.clinic_level) === selectedLevel
    );
  }, [isFacultyOrAdmin, credits, selectedLevel, showAllStudentCredits]);

  // Faculty / Admin: Cohort Competency Matrix grouped by student_email / student_name
  const cohortMatrix = useMemo(() => {
    if (!isFacultyOrAdmin) return [];
    const totalRequiredForLevel = levelCategories.reduce(
      (sum, c) => sum + c.required,
      0
    );

    const studentsMap = new Map();
    credits
      .filter((c) => normalizeClinicLevel(c.clinic_level) === selectedLevel)
      .forEach((c) => {
        const email = String(c.student_email || "").trim().toLowerCase();
        const name = String(c.student_name || "").trim();
        const key = email || name.toLowerCase() || "unassigned-student";
        if (!studentsMap.has(key)) {
          studentsMap.set(key, {
            key,
            studentEmail: c.student_email || "—",
            studentName: name || (c.student_email ? c.student_email.split("@")[0] : "Student Clinician"),
            clinicLevel: selectedLevel,
            byCategory: {},
            creditRows: [],
          });
        }
        const entry = studentsMap.get(key);
        const cat = String(c.procedure_category || "General Procedure").trim();
        entry.byCategory[cat] = (entry.byCategory[cat] || 0) + getCreditValue(c);
        entry.creditRows.push(c);
      });

    const searchLower = cohortSearch.trim().toLowerCase();

    return Array.from(studentsMap.values())
      .map((entry) => {
        let totalCapped = 0;
        let totalRaw = 0;
        levelCategories.forEach((cat) => {
          const earned = entry.byCategory[cat.category] || 0;
          totalRaw += earned;
          totalCapped += cat.required > 0 ? Math.min(earned, cat.required) : earned;
        });
        const overallPct =
          totalRequiredForLevel > 0
            ? Math.min(100, Math.round((totalCapped / totalRequiredForLevel) * 100))
            : totalRaw > 0
            ? 100
            : 0;
        return {
          ...entry,
          totalEarned: totalRaw,
          totalRequired: totalRequiredForLevel,
          overallPct,
        };
      })
      .filter((entry) => {
        if (!searchLower) return true;
        return `${entry.studentName} ${entry.studentEmail}`
          .toLowerCase()
          .includes(searchLower);
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName));
  }, [isFacultyOrAdmin, credits, selectedLevel, levelCategories, cohortSearch]);

  const selectedCohortStudent = useMemo(() => {
    if (!selectedStudentEmail) return null;
    return cohortMatrix.find((s) => s.key === selectedStudentEmail) || null;
  }, [cohortMatrix, selectedStudentEmail]);

  const handleExportCohortCsv = () => {
    const headers = [
      "Student Name",
      "Student Email",
      "Clinic Level",
      ...levelCategories.map((c) => `${c.category} (Req: ${c.required})`),
      "Total Earned",
      "Total Required",
      "Overall Competency (%)",
    ];

    const rows = cohortMatrix.map((student) => [
      student.studentName,
      student.studentEmail,
      student.clinicLevel,
      ...levelCategories.map(
        (c) => `${student.byCategory[c.category] || 0} / ${c.required}`
      ),
      student.totalEarned,
      student.totalRequired,
      `${student.overallPct}%`,
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map(escapeCsvCell).join(","))
      .join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ceu-cohort-competency-${selectedLevel
      .toLowerCase()
      .replace(/\s+/g, "-")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Layout
      active="requirements"
      onNavigate={onNavigate}
      currentUser={currentUser}
      onSignOut={onSignOut}
    >
      <div className="page-header-row">
        <div>
          <h1 className="page-title">
            {isFacultyOrAdmin ? "Cohort Clinical Requirements" : "Clinical Requirements"}
          </h1>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: "13.5px",
              fontWeight: 600,
              color: "#475569",
            }}
          >
            {isFacultyOrAdmin
              ? "Competency completion matrix across supervised student clinicians"
              : "Track faculty-approved procedure credits toward clinic graduation requirements"}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div className="filter-select-wrap">
            <select
              className="filter-select"
              value={selectedLevel}
              onChange={(e) => handleLevelChange(e.target.value)}
              aria-label="Select Clinic Level"
            >
              {CLINIC_LEVELS.map((lvl) => (
                <option key={lvl} value={lvl}>
                  {lvl}
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

          <button
            type="button"
            className="pill"
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>

          {isFacultyOrAdmin && (
            <button
              type="button"
              className="pill pill--primary"
              onClick={handleExportCohortCsv}
              disabled={cohortMatrix.length === 0}
            >
              Export Cohort CSV
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            borderRadius: "12px",
            padding: "12px 16px",
            marginBottom: "16px",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div
          style={{
            background: "#ffffff",
            borderRadius: "14px",
            padding: "36px 24px",
            textAlign: "center",
            color: "#475569",
            fontWeight: 700,
            fontSize: "14px",
            boxShadow: "0 6px 20px rgba(15, 23, 42, 0.05)",
          }}
        >
          Loading clinical requirements...
        </div>
      ) : !isFacultyOrAdmin ? (
        <div style={{ display: "grid", gap: "18px" }}>
          {/* Overall Graduation Competency Card */}
          <section
            aria-label="Overall Graduation Competency"
            style={{
              background: "#ffffff",
              borderRadius: "14px",
              padding: "20px 24px",
              boxShadow: "0 6px 20px rgba(15, 23, 42, 0.05)",
              display: "grid",
              gap: "12px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                flexWrap: "wrap",
                gap: "12px",
              }}
            >
              <div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Overall Competency — {selectedLevel}
                </div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a", marginTop: "4px", fontVariantNumeric: "tabular-nums" }}>
                  {studentProgress.totalEarned} of {studentProgress.totalRequired} required cases completed
                </div>
              </div>

              <div
                style={{
                  fontSize: "34px",
                  fontWeight: 800,
                  color: studentProgress.overallPct >= 100 ? "#059669" : "#e11d74",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                }}
              >
                {studentProgress.overallPct}%
              </div>
            </div>

            <div
              style={{
                height: "12px",
                background: "#f1f5f9",
                borderRadius: "999px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${studentProgress.overallPct}%`,
                  height: "100%",
                  background: studentProgress.overallPct >= 100 ? "#059669" : "#e11d74",
                  borderRadius: "999px",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </section>

          {/* Category-by-Category Progress Bars */}
          <section
            aria-label="Requirement Categories Progress"
            style={{
              background: "#ffffff",
              borderRadius: "14px",
              padding: "20px 24px",
              boxShadow: "0 6px 20px rgba(15, 23, 42, 0.05)",
              display: "grid",
              gap: "14px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
                Category Progress ({selectedLevel})
              </h2>
              <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#64748b", fontVariantNumeric: "tabular-nums" }}>
                {studentProgress.categories.length} requirement categor
                {studentProgress.categories.length === 1 ? "y" : "ies"}
              </span>
            </div>

            {studentProgress.categories.length === 0 ? (
              <div style={{ padding: "14px 0", fontSize: "13.5px", color: "#64748b", fontWeight: 600 }}>
                No requirement targets are configured for {selectedLevel} yet.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: "14px",
                }}
              >
                {studentProgress.categories.map((cat) => {
                  const isComplete = cat.required > 0 && cat.earned >= cat.required;
                  return (
                    <div
                      key={cat.category}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "12px",
                        padding: "14px 16px",
                        background: "#f8fafc",
                        display: "grid",
                        gap: "8px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "10px" }}>
                        <span style={{ fontSize: "13.5px", fontWeight: 800, color: "#0f172a" }}>
                          {cat.category}
                        </span>
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 800,
                            color: isComplete ? "#047857" : "#be185d",
                            fontVariantNumeric: "tabular-nums",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {cat.earned} / {cat.required}
                        </span>
                      </div>

                      <div
                        style={{
                          height: "8px",
                          background: "#e2e8f0",
                          borderRadius: "999px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${cat.pct}%`,
                            height: "100%",
                            background: isComplete ? "#059669" : "#ff4796",
                            borderRadius: "999px",
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11.5px", fontWeight: 600, color: "#64748b", fontVariantNumeric: "tabular-nums" }}>
                        <span>{isComplete ? "Requirement met" : `${Math.max(0, cat.required - cat.earned)} remaining`}</span>
                        <span>{cat.pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Itemized Faculty-Approved Case Credits Table */}
          <section aria-label="Faculty-Approved Case Credits">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "10px",
                marginBottom: "10px",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 800, color: "#0f172a" }}>
                Faculty-Approved Case Credits
              </h2>
              <button
                type="button"
                className="table__action"
                onClick={() => setShowAllStudentCredits((prev) => !prev)}
              >
                {showAllStudentCredits ? `Filter to ${selectedLevel}` : `Show All Levels (${credits.length})`}
              </button>
            </div>

            <div className="table-wrap">
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Patient ID</th>
                      <th>Category</th>
                      <th>Procedure</th>
                      <th>Tooth #</th>
                      <th>Signed By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentDisplayedCredits.map((credit, idx) => {
                      const rawPid =
                        credit.patient_eight_digit_id ||
                        credit.eight_digit_id ||
                        credit.patient_id ||
                        "";
                      const formattedPid = rawPid ? to8DigitId(rawPid) : "—";
                      const rowKey = credit.id || `credit-${idx}`;
                      return (
                        <tr key={rowKey}>
                          <td className="table__date-cell">{formatCreditDate(credit)}</td>
                          <td className="table__id-cell">{formattedPid}</td>
                          <td style={{ fontWeight: 700 }}>
                            {credit.procedure_category || "General"}
                          </td>
                          <td>{credit.procedure_name || credit.procedure || "—"}</td>
                          <td style={{ fontVariantNumeric: "tabular-nums" }}>
                            {credit.tooth_number || credit.tooth_no || "—"}
                          </td>
                          <td>
                            {credit.approved_by_name ||
                              credit.faculty_name ||
                              credit.signed_by ||
                              "Supervising Faculty"}
                          </td>
                        </tr>
                      );
                    })}

                    {studentDisplayedCredits.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ padding: "26px", color: "#64748b", fontWeight: 600 }}>
                          {credits.length > 0 && !showAllStudentCredits
                            ? `No faculty-approved case credits logged under ${selectedLevel}. Switch levels or click "Show All Levels".`
                            : "No faculty-approved case credits recorded yet."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "18px" }}>
          <div className="toolbar" style={{ marginBottom: 0 }}>
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
                  placeholder="Search student name or email"
                  value={cohortSearch}
                  onChange={(e) => setCohortSearch(e.target.value)}
                  aria-label="Search student clinician"
                />
              </div>
            </div>

            <div className="toolbar__right" style={{ fontSize: "13px", fontWeight: 700, color: "#475569", fontVariantNumeric: "tabular-nums" }}>
              <span>
                {cohortMatrix.length} clinician{cohortMatrix.length === 1 ? "" : "s"} ·{" "}
                {levelCategories.length} categor{levelCategories.length === 1 ? "y" : "ies"}
              </span>
            </div>
          </div>

          <div className="table-wrap">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Student Clinician</th>
                    <th>Level</th>
                    {levelCategories.map((cat) => (
                      <th key={cat.category} style={{ fontVariantNumeric: "tabular-nums" }}>
                        <div>{cat.category}</div>
                        <div style={{ fontSize: "11px", fontWeight: 600, opacity: 0.85 }}>
                          Req: {cat.required}
                        </div>
                      </th>
                    ))}
                    <th>Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {cohortMatrix.map((student) => {
                    const isSelected = selectedStudentEmail === student.key;
                    return (
                      <tr
                        key={student.key}
                        onClick={() =>
                          setSelectedStudentEmail(isSelected ? null : student.key)
                        }
                        style={{
                          cursor: "pointer",
                          background: isSelected ? "#fff1f7" : undefined,
                        }}
                        title="Click row to inspect student's approved case credits"
                      >
                        <td style={{ textAlign: "left" }}>
                          <div style={{ fontWeight: 800, color: "#0f172a" }}>
                            {student.studentName}
                          </div>
                          <div style={{ fontSize: "12px", color: "#64748b" }}>
                            {student.studentEmail}
                          </div>
                        </td>
                        <td style={{ fontWeight: 700 }}>{student.clinicLevel}</td>
                        {levelCategories.map((cat) => {
                          const earned = student.byCategory[cat.category] || 0;
                          const met = cat.required > 0 && earned >= cat.required;
                          return (
                            <td
                              key={cat.category}
                              style={{
                                fontVariantNumeric: "tabular-nums",
                                fontWeight: 700,
                                color: met ? "#047857" : "#0f172a",
                              }}
                            >
                              {earned} / {cat.required}
                            </td>
                          );
                        })}
                        <td
                          style={{
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: 800,
                            color: student.overallPct >= 100 ? "#047857" : "#be185d",
                          }}
                        >
                          {student.overallPct}%
                        </td>
                      </tr>
                    );
                  })}

                  {cohortMatrix.length === 0 && (
                    <tr>
                      <td
                        colSpan={3 + levelCategories.length}
                        style={{ padding: "26px", color: "#64748b", fontWeight: 600 }}
                      >
                        No student requirement credits recorded for {selectedLevel}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedCohortStudent && (
            <section aria-label="Selected Clinician Case Credits">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "10px",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
                  Approved Case Credits — {selectedCohortStudent.studentName} ({selectedLevel})
                </h2>
                <button
                  type="button"
                  className="table__action"
                  onClick={() => setSelectedStudentEmail(null)}
                >
                  Close Detail
                </button>
              </div>
              <div className="table-wrap">
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Patient ID</th>
                        <th>Category</th>
                        <th>Procedure</th>
                        <th>Tooth #</th>
                        <th>Signed By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedCohortStudent.creditRows.map((credit, idx) => {
                        const rawPid =
                          credit.patient_eight_digit_id ||
                          credit.eight_digit_id ||
                          credit.patient_id ||
                          "";
                        return (
                          <tr key={credit.id || `detail-${idx}`}>
                            <td className="table__date-cell">{formatCreditDate(credit)}</td>
                            <td className="table__id-cell">
                              {rawPid ? to8DigitId(rawPid) : "—"}
                            </td>
                            <td style={{ fontWeight: 700 }}>
                              {credit.procedure_category || "General"}
                            </td>
                            <td>{credit.procedure_name || credit.procedure || "—"}</td>
                            <td style={{ fontVariantNumeric: "tabular-nums" }}>
                              {credit.tooth_number || credit.tooth_no || "—"}
                            </td>
                            <td>
                              {credit.approved_by_name ||
                                credit.faculty_name ||
                                credit.signed_by ||
                                "Supervising Faculty"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </Layout>
  );
}
