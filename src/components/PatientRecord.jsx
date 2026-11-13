import { useState, useEffect, useMemo } from "react";
import Layout from "./Layout";
import { normalizeRole, isStudentClinician, canDeleteRecords } from "../lib/roleUtils";
import {
  to8DigitId,
  DEFAULT_CLINICIAN,
  fetchPatientHistoryRecords,
} from "../lib/dentalService";

const MOCK_PATIENTS = [
  { id: "10000001", name: "John Doe", lastVisit: "01/01/2026", clinician: DEFAULT_CLINICIAN },
];
const LIST_ROWS = 11;
const HISTORY_ROWS = 9;

function buildAllergyLines(patient) {
  const odf = patient?.odfData || {};
  const lines = [];

  if (odf.allergySpecify && odf.allergySpecify.trim() && odf.allergySpecify.trim().toLowerCase() !== "none") {
    lines.push(`Allergies: ${odf.allergySpecify.trim()}`);
  }
  if (
    odf.localAnesthesiaAllergy &&
    odf.localAnesthesiaAllergy.trim() &&
    odf.localAnesthesiaAllergy.trim().toLowerCase() !== "none"
  ) {
    lines.push(`Local Anesthesia: ${odf.localAnesthesiaAllergy.trim()}`);
  }
  if (
    odf.otherIllnesses &&
    odf.otherIllnesses.trim() &&
    odf.otherIllnesses.trim().toLowerCase() !== "none"
  ) {
    lines.push(`Other Illnesses: ${odf.otherIllnesses.trim()}`);
  }
  if (
    odf.medications &&
    odf.medications.trim() &&
    odf.medications.trim().toLowerCase() !== "none"
  ) {
    lines.push(`Medications: ${odf.medications.trim()}`);
  }

  if (lines.length === 0) {
    lines.push("No known allergies recorded");
  }

  while (lines.length < 7) {
    lines.push("");
  }
  return lines.slice(0, 7);
}

export default function PatientRecord({
  onNavigate,
  patients = MOCK_PATIENTS,
  pending = [],
  onViewRecords = () => {},
  onDeleteSelectedRecords = async () => ({ success: false }),
  onDeletePatient = async () => ({ success: false }),
  currentUser,
  onSignOut,
}) {
  const [query, setQuery] = useState("");
  const [filterBy, setFilterBy] = useState("all");
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [visitHistory, setVisitHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedRecordIds, setSelectedRecordIds] = useState([]);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { mode: "records" | "patient", patient, records }
  const [isDeleting, setIsDeleting] = useState(false);
  const [patientRecordsState, setPatientRecordsState] = useState({ key: "", records: [] });

  const normRole = normalizeRole(currentUser?.role);
  const isPatientRole = normRole === "patient";
  const isStudent = isStudentClinician(normRole);
  const allowDelete = canDeleteRecords(currentUser?.role);

  // Keep selected patient object live-synced with patients state (clinician/faculty/admin only)
  const selectedPatient = useMemo(() => {
    if (isPatientRole || !selectedPatientId) return null;
    return patients.find((p) => to8DigitId(p.id) === selectedPatientId) || null;
  }, [isPatientRole, patients, selectedPatientId]);

  useEffect(() => {
    if (isPatientRole || !selectedPatient) return;
    let active = true;
    fetchPatientHistoryRecords(selectedPatient).then((res) => {
      if (active) {
        setVisitHistory(Array.isArray(res) ? res : []);
        setLoadingHistory(false);
      }
    });
    return () => {
      active = false;
    };
  }, [isPatientRole, selectedPatient, patients, pending]);

  // Keep checked record IDs synchronized with currently loaded visitHistory
  const validSelectedIds = useMemo(() => {
    const validSet = new Set(visitHistory.map((r) => r.id));
    return selectedRecordIds.filter((id) => validSet.has(id));
  }, [selectedRecordIds, visitHistory]);

  const allVisibleRecordsSelected =
    visitHistory.length > 0 && validSelectedIds.length === visitHistory.length;

  const toggleSelectAllRecords = () => {
    if (allVisibleRecordsSelected) {
      setSelectedRecordIds([]);
    } else {
      setSelectedRecordIds(visitHistory.map((r) => r.id));
    }
  };

  const toggleRecordSelection = (recordId) => {
    setSelectedRecordIds((prev) =>
      prev.includes(recordId) ? prev.filter((id) => id !== recordId) : [...prev, recordId]
    );
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm || !allowDelete) return;
    setIsDeleting(true);
    try {
      if (deleteConfirm.mode === "patient") {
        const targetId = to8DigitId(deleteConfirm.patient?.id);
        await onDeletePatient(deleteConfirm.patient);
        if (selectedPatientId === targetId) {
          setSelectedPatientId(null);
          setVisitHistory([]);
          setSelectedRecordIds([]);
        }
      } else if (deleteConfirm.mode === "records") {
        const recs = deleteConfirm.records || [];
        await onDeleteSelectedRecords(deleteConfirm.patient, recs);
        const deletedIdsSet = new Set(recs.map((r) => r.id));
        setVisitHistory((prev) => prev.filter((r) => !deletedIdsSet.has(r.id)));
        setSelectedRecordIds((prev) => prev.filter((id) => !deletedIdsSet.has(id)));
      }
    } finally {
      setIsDeleting(false);
      setDeleteConfirm(null);
    }
  };

  // Role filtering
  const roleFilteredPatients = useMemo(() => {
    return patients.filter((p) => {
      if (normRole === "patient") {
        const userEmail = (currentUser?.email || "").toLowerCase();
        const patientEmail = (p.email || "").toLowerCase();
        return (
          patientEmail === userEmail ||
          p.name.toLowerCase().includes("john doe") ||
          to8DigitId(p.id) === "10000001"
        );
      }
      if (isStudent) {
        const isAttended =
          p.clinician?.toLowerCase().includes("student clinician") ||
          p.clinician?.toLowerCase().includes("doe, jane") ||
          p.clinician === DEFAULT_CLINICIAN ||
          p.clinician?.toLowerCase().includes((currentUser?.email || "").toLowerCase());
        return isAttended;
      }
      return true;
    });
  }, [patients, normRole, isStudent, currentUser]);

  const patientRecordsFetchKey = useMemo(() => {
    if (!isPatientRole) return "";
    return `${roleFilteredPatients.map((p) => to8DigitId(p.id)).join(",")}|p:${pending.length}|n:${patients.length}`;
  }, [isPatientRole, roleFilteredPatients, pending.length, patients.length]);

  useEffect(() => {
    if (!isPatientRole) return;
    let active = true;
    Promise.all(
      roleFilteredPatients.map(async (p) => {
        const recs = await fetchPatientHistoryRecords(p);
        return (Array.isArray(recs) ? recs : []).map((rec) => ({
          ...rec,
          _patient: p,
        }));
      })
    ).then((nested) => {
      if (!active) return;
      const flat = nested.flat();
      const seen = new Set();
      const merged = [];
      for (const rec of flat) {
        const key = `${to8DigitId(rec._patient?.id)}::${rec.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(rec);
        }
      }
      setPatientRecordsState({ key: patientRecordsFetchKey, records: merged });
    });
    return () => {
      active = false;
    };
  }, [isPatientRole, roleFilteredPatients, patientRecordsFetchKey]);

  const isLoadingPatientRecords =
    isPatientRole && roleFilteredPatients.length > 0 && patientRecordsState.key !== patientRecordsFetchKey;

  const patientRecordsList = useMemo(() => {
    if (!isPatientRole) return [];
    const searchLower = query.trim().toLowerCase();
    const list = patientRecordsState.records.filter((rec) => {
      const clinicianName = rec.clinician || rec._patient?.clinician || DEFAULT_CLINICIAN;
      const visitDate = rec.date || rec._patient?.lastVisit || "";
      const matchesSearch =
        !searchLower ||
        `${visitDate} ${clinicianName} ${rec.title || ""} ${rec.summary || ""} ${rec.diagnosis || ""}`
          .toLowerCase()
          .includes(searchLower);

      if (!matchesSearch) return false;
      if (filterBy === "has_odf") {
        return rec.type === "odf" || !!(rec.rawScanUrl || rec.odontogramCropUrl || rec.odfDetails);
      }
      if (filterBy.startsWith("clinician:")) {
        const targetClinician = filterBy.slice("clinician:".length);
        return clinicianName === targetClinician;
      }
      return true;
    });

    if (filterBy === "recent") {
      return [...list].sort(
        (a, b) => new Date(b.date || b._patient?.lastVisit || 0) - new Date(a.date || a._patient?.lastVisit || 0)
      );
    }
    return list;
  }, [isPatientRole, patientRecordsState.records, query, filterBy]);

  // Unique clinicians for Filter By dropdown
  const clinicianOptions = useMemo(() => {
    const set = new Set();
    if (isPatientRole) {
      patientRecordsState.records.forEach((rec) => {
        const c = rec.clinician || rec._patient?.clinician;
        if (c) set.add(c);
      });
    } else {
      roleFilteredPatients.forEach((p) => {
        if (p.clinician) set.add(p.clinician);
      });
    }
    return Array.from(set);
  }, [isPatientRole, patientRecordsState.records, roleFilteredPatients]);

  const filtered = useMemo(() => {
    const searchLower = query.trim().toLowerCase();
    const list = roleFilteredPatients.filter((p) => {
      const formattedId = to8DigitId(p.id);
      const matchesSearch =
        !searchLower ||
        `${formattedId} ${p.name} ${p.clinician || ""} ${p.lastVisit || ""}`
          .toLowerCase()
          .includes(searchLower);

      if (!matchesSearch) return false;
      if (filterBy === "has_odf") {
        return !!(p.odfData || p.latestOdfScanUrl);
      }
      if (filterBy.startsWith("clinician:")) {
        const targetClinician = filterBy.slice("clinician:".length);
        return (p.clinician || DEFAULT_CLINICIAN) === targetClinician;
      }
      return true;
    });

    if (filterBy === "name_az") {
      return [...list].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }
    if (filterBy === "recent") {
      return [...list].sort((a, b) => new Date(b.lastVisit || 0) - new Date(a.lastVisit || 0));
    }
    return list;
  }, [roleFilteredPatients, query, filterBy]);

  const activeListCount = isPatientRole ? patientRecordsList.length : filtered.length;
  const listBlanks = Math.max(0, LIST_ROWS - activeListCount);
  const historyBlanks = Math.max(0, HISTORY_ROWS - visitHistory.length);
  const historyColCount = allowDelete ? 4 : 3;

  const renderDeleteModal = () => {
    if (!deleteConfirm || !allowDelete) return null;
    const isPatientDelete = deleteConfirm.mode === "patient";
    const targetPatient = deleteConfirm.patient;
    const targetRecords = deleteConfirm.records || [];

    return (
      <div
        className="confirm-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label={isPatientDelete ? "Confirm Delete Patient Record" : "Confirm Delete Selected Records"}
        onClick={() => !isDeleting && setDeleteConfirm(null)}
      >
        <div className="confirm-modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="confirm-modal-header">
            <h3 className="confirm-modal-title">
              {isPatientDelete
                ? "Delete Entire Patient Record?"
                : `Delete ${targetRecords.length} Selected Record${targetRecords.length > 1 ? "s" : ""}?`}
            </h3>
            <button
              type="button"
              className="confirm-modal-close"
              onClick={() => !isDeleting && setDeleteConfirm(null)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="confirm-modal-body">
            <p className="confirm-modal-text">
              {isPatientDelete
                ? "This action will permanently remove this patient and all of their associated clinical visits, ODF forms, and pending submissions."
                : "This action will permanently delete the selected clinical visit/ODF record(s) from this patient's history."}
            </p>
            <div className="confirm-modal-detail">
              <div>
                Patient: <strong>{targetPatient?.name}</strong> (ID #{to8DigitId(targetPatient?.id)})
              </div>
              {!isPatientDelete && targetRecords.length > 0 && (
                <div style={{ marginTop: "6px", fontWeight: 500 }}>
                  Selected:{" "}
                  {targetRecords
                    .slice(0, 3)
                    .map((r) => `${r.date || "Visit"} — ${r.title || "Record"}`)
                    .join("; ")}
                  {targetRecords.length > 3 ? ` (+${targetRecords.length - 3} more)` : ""}
                </div>
              )}
            </div>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="pill"
                style={{ height: "38px", padding: "0 16px" }}
                disabled={isDeleting}
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pill pill--danger"
                style={{ height: "38px", padding: "0 18px", background: "#dc2626", color: "#fff", borderColor: "#dc2626" }}
                disabled={isDeleting}
                onClick={handleConfirmDelete}
              >
                {isDeleting ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // =========================================================================
  // SELECTED PATIENT DETAIL & VISIT HISTORY VIEW
  // =========================================================================
  if (selectedPatient) {
    const odf = selectedPatient.odfData || {};
    const formattedId = to8DigitId(selectedPatient.id);
    const allergyLines = buildAllergyLines(selectedPatient);
    const selectedRecordsObjects = visitHistory.filter((r) => validSelectedIds.includes(r.id));

    return (
      <Layout
        active="patients"
        onNavigate={onNavigate}
        currentUser={currentUser}
        onSignOut={onSignOut}
      >
        <div className="page-header-row">
          <h1 className="page-title">
            {normRole === "patient" ? "My Patient Record" : "Patient Records"}
          </h1>

          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            {allowDelete && (
              <button
                type="button"
                className="pill pill--danger"
                onClick={() =>
                  setDeleteConfirm({
                    mode: "patient",
                    patient: selectedPatient,
                    records: [],
                  })
                }
              >
                Delete Patient Record
              </button>
            )}
            <button
              type="button"
              className="pill"
              onClick={() => {
                setSelectedPatientId(null);
                setVisitHistory([]);
                setSelectedRecordIds([]);
              }}
            >
              ← Back to Patient Records
            </button>
          </div>
        </div>

        {/* Two Top Info Cards matching Selected Patient Mockup */}
        <div className="selected-patient-grid">
          {/* Left Card: Demographics */}
          <section className="patient-info-card" aria-label="Patient Demographics">
            <div className="patient-info-card__header">
              <div>
                <span className="patient-info-card__name">{selectedPatient.name}</span>
                <span className="patient-info-card__name-hint">(Last Name, First Name M.I.)</span>
              </div>
              <div className="patient-info-card__id">
                Patient ID<code>{formattedId}</code>
              </div>
            </div>

            <div className="patient-info-card__vitals-row">
              <div>
                <div className="patient-info-metric__label">Sex</div>
                <div className="patient-info-metric__value">
                  {selectedPatient.gender || odf.sex || "—"}
                </div>
              </div>
              <div>
                <div className="patient-info-metric__label">Birth Date</div>
                <div className="patient-info-metric__value">
                  {selectedPatient.dateOfBirth || odf.birthDate || "—"}
                </div>
              </div>
              <div>
                <div className="patient-info-metric__label">Age</div>
                <div className="patient-info-metric__value">
                  {selectedPatient.age || odf.age || "—"}
                </div>
              </div>
              <div>
                <div className="patient-info-metric__label">Height</div>
                <div className="patient-info-metric__value">
                  {odf.height || selectedPatient.height || "—"}
                </div>
              </div>
              <div>
                <div className="patient-info-metric__label">Weight</div>
                <div className="patient-info-metric__value">
                  {odf.weight || selectedPatient.weight || "—"}
                </div>
              </div>
            </div>

            <div className="patient-info-card__details-list">
              <div className="patient-info-detail-row">
                <span className="patient-info-detail-row__label">Home Address</span>
                <span className="patient-info-detail-row__value">
                  {selectedPatient.homeAddress || odf.homeAddress || "—"}
                </span>
              </div>
              <div className="patient-info-detail-row">
                <span className="patient-info-detail-row__label">Home Tel. No.</span>
                <span className="patient-info-detail-row__value">
                  {odf.homeTel || selectedPatient.homeTel || "—"}
                </span>
              </div>
              <div className="patient-info-detail-row">
                <span className="patient-info-detail-row__label">Cellphone No.</span>
                <span className="patient-info-detail-row__value">
                  {selectedPatient.phone || odf.cellPhone || "—"}
                </span>
              </div>
              <div className="patient-info-detail-row">
                <span className="patient-info-detail-row__label">Nationality</span>
                <span className="patient-info-detail-row__value">
                  {odf.nationality || selectedPatient.nationality || "—"}
                </span>
              </div>
              <div className="patient-info-detail-row">
                <span className="patient-info-detail-row__label">Occupation</span>
                <span className="patient-info-detail-row__value">
                  {odf.occupation || selectedPatient.occupation || "—"}
                </span>
              </div>
              <div className="patient-info-detail-row">
                <span className="patient-info-detail-row__label">Religion</span>
                <span className="patient-info-detail-row__value">
                  {odf.religion || selectedPatient.religion || "—"}
                </span>
              </div>
              <div className="patient-info-detail-row">
                <span className="patient-info-detail-row__label">Civil Status</span>
                <span className="patient-info-detail-row__value">
                  {odf.civilStatus || selectedPatient.civilStatus || "—"}
                </span>
              </div>
            </div>
          </section>

          {/* Right Card: Allergy Information */}
          <section className="allergy-card" aria-label="Allergy Information">
            <h2 className="allergy-card__title">Allergy Information</h2>
            <div className="allergy-card__lines">
              {allergyLines.map((lineText, idx) => (
                <div
                  key={idx}
                  className={`allergy-card__line ${
                    lineText === "No known allergies recorded" ? "allergy-card__line--muted" : ""
                  }`}
                >
                  {lineText}
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Bottom Visit History Table */}
        <div className="table-wrap">
          {allowDelete && visitHistory.length > 0 && (
            <div className="table-selection-bar">
              <span className="table-selection-bar__info">
                {validSelectedIds.length > 0
                  ? `${validSelectedIds.length} record${validSelectedIds.length > 1 ? "s" : ""} selected`
                  : "Select records to delete"}
              </span>
              <div className="table-selection-bar__actions">
                {validSelectedIds.length > 0 && (
                  <button
                    type="button"
                    className="table__action"
                    onClick={() => setSelectedRecordIds([])}
                  >
                    Clear Selection
                  </button>
                )}
                <button
                  type="button"
                  className="table__action table__action--decline"
                  disabled={validSelectedIds.length === 0}
                  style={validSelectedIds.length === 0 ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                  onClick={() =>
                    setDeleteConfirm({
                      mode: "records",
                      patient: selectedPatient,
                      records: selectedRecordsObjects,
                    })
                  }
                >
                  Delete Selected{validSelectedIds.length > 0 ? ` (${validSelectedIds.length})` : ""}
                </button>
              </div>
            </div>
          )}

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  {allowDelete && (
                    <th className="table__checkbox-col">
                      <input
                        type="checkbox"
                        className="table__checkbox"
                        checked={allVisibleRecordsSelected}
                        onChange={toggleSelectAllRecords}
                        aria-label="Select all records"
                        title="Select all records"
                      />
                    </th>
                  )}
                  <th>Visit Date (MM/DD/YYYY)</th>
                  <th>Attending Clinician</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingHistory ? (
                  <tr>
                    <td colSpan={historyColCount} style={{ padding: "28px", color: "#64748b", fontWeight: 600 }}>
                      Loading consultation & ODF history...
                    </td>
                  </tr>
                ) : (
                  <>
                    {visitHistory.map((rec) => {
                      const isChecked = validSelectedIds.includes(rec.id);
                      return (
                        <tr key={rec.id}>
                          {allowDelete && (
                            <td className="table__checkbox-cell">
                              <input
                                type="checkbox"
                                className="table__checkbox"
                                checked={isChecked}
                                onChange={() => toggleRecordSelection(rec.id)}
                                aria-label={`Select record from ${rec.date || "visit"}`}
                              />
                            </td>
                          )}
                          <td className="table__date-cell" style={{ fontWeight: 600 }}>
                            {rec.date || selectedPatient.lastVisit || "01/01/2026"}
                          </td>
                          <td>{rec.clinician || selectedPatient.clinician || DEFAULT_CLINICIAN}</td>
                          <td className="table__actions-cell">
                            <div className="table__actions-group">
                              <button
                                type="button"
                                className="table__action table__action--review"
                                onClick={() => onViewRecords(selectedPatient, rec)}
                                title={`Open full 2-page form for ${rec.title || "record"}`}
                              >
                                View Record
                              </button>
                              {allowDelete && (
                                <button
                                  type="button"
                                  className="table__action table__action--decline"
                                  onClick={() =>
                                    setDeleteConfirm({
                                      mode: "records",
                                      patient: selectedPatient,
                                      records: [rec],
                                    })
                                  }
                                  title="Delete this record"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {visitHistory.length === 0 && (
                      <tr>
                        <td colSpan={historyColCount} style={{ padding: "26px", color: "#64748b", fontWeight: 600 }}>
                          No consultation or ODF records found for this patient.
                        </td>
                      </tr>
                    )}
                    {Array.from({ length: historyBlanks }, (_, i) => (
                      <tr key={`hist-blank-${i}`}>
                        <td colSpan={historyColCount} style={{ height: "42px" }} />
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {renderDeleteModal()}
      </Layout>
    );
  }

  // =========================================================================
  // PATIENT RECORDS DIRECTORY LIST VIEW
  // =========================================================================
  return (
    <Layout
      active="patients"
      onNavigate={onNavigate}
      currentUser={currentUser}
      onSignOut={onSignOut}
    >
      <div className="page-header-row">
        <h1 className="page-title">
          {normRole === "patient" ? "My Patient Record" : "Patient Records"}
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
              placeholder={isPatientRole ? "Search Visits" : "Search Patients"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={isPatientRole ? "Search Visits" : "Search Patients"}
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
              {!isPatientRole && <option value="name_az">Name (A – Z)</option>}
              <option value="has_odf">Has ODF Record</option>
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
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="table">
            <thead>
              {isPatientRole ? (
                <tr>
                  <th>Date of Visit (MM/DD/YYYY)</th>
                  <th>Attending Clinician</th>
                  <th>Actions</th>
                </tr>
              ) : (
                <tr>
                  <th>Patient ID</th>
                  <th>Name</th>
                  <th>Last Visit (MM/DD/YYYY)</th>
                  <th>Attending Clinician</th>
                  <th>Actions</th>
                </tr>
              )}
            </thead>
            <tbody>
              {isPatientRole ? (
                isLoadingPatientRecords ? (
                  <tr>
                    <td colSpan={3} style={{ padding: "28px", color: "#64748b", fontWeight: 600 }}>
                      Loading your dental records...
                    </td>
                  </tr>
                ) : (
                  <>
                    {patientRecordsList.map((rec) => {
                      const ownerPatient = rec._patient || roleFilteredPatients[0];
                      return (
                        <tr key={`${to8DigitId(ownerPatient?.id)}_${rec.id}`}>
                          <td className="table__date-cell" style={{ fontWeight: 600 }}>
                            {rec.date || ownerPatient?.lastVisit || "01/01/2026"}
                          </td>
                          <td>{rec.clinician || ownerPatient?.clinician || DEFAULT_CLINICIAN}</td>
                          <td className="table__actions-cell">
                            <div className="table__actions-group">
                              <button
                                type="button"
                                className="table__action table__action--review"
                                onClick={() => onViewRecords(ownerPatient, rec)}
                                title={`Open full 2-page form for ${rec.title || "record"}`}
                              >
                                View Record
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {patientRecordsList.length === 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          style={{ padding: "26px", color: "#64748b", fontWeight: 600 }}
                        >
                          No matching visit records found.
                        </td>
                      </tr>
                    )}

                    {Array.from({ length: listBlanks }, (_, i) => (
                      <tr key={`blank-${i}`}>
                        <td colSpan={3} style={{ height: "42px" }} />
                      </tr>
                    ))}
                  </>
                )
              ) : (
                <>
                  {filtered.map((p) => {
                    const formatted8DigitId = to8DigitId(p.id);
                    return (
                      <tr key={formatted8DigitId}>
                        <td className="table__id-cell">{formatted8DigitId}</td>
                        <td style={{ fontWeight: 600 }}>{p.name}</td>
                        <td className="table__date-cell">{p.lastVisit}</td>
                        <td>{p.clinician || DEFAULT_CLINICIAN}</td>
                        <td className="table__actions-cell">
                          <div className="table__actions-group">
                            <button
                              type="button"
                              className="table__action table__action--review"
                              onClick={() => {
                                setLoadingHistory(true);
                                setSelectedRecordIds([]);
                                setSelectedPatientId(formatted8DigitId);
                              }}
                              title="Open patient demographics & visit history"
                            >
                              View Records
                            </button>
                            {allowDelete && (
                              <button
                                type="button"
                                className="table__action table__action--decline"
                                onClick={() =>
                                  setDeleteConfirm({
                                    mode: "patient",
                                    patient: p,
                                    records: [],
                                  })
                                }
                                title={`Delete entire record for ${p.name}`}
                              >
                                Delete Patient
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        style={{ padding: "26px", color: "#64748b", fontWeight: 600 }}
                      >
                        No matching patient records found.
                      </td>
                    </tr>
                  )}

                  {Array.from({ length: listBlanks }, (_, i) => (
                    <tr key={`blank-${i}`}>
                      <td colSpan={5} style={{ height: "42px" }} />
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {renderDeleteModal()}
    </Layout>
  );
}
