import { useState, useEffect, useMemo } from "react";
import Layout from "./Layout";
import { normalizeRole, isStudentClinician, canDeleteRecords } from "../lib/roleUtils";
import {
  to8DigitId,
  DEFAULT_CLINICIAN,
  fetchPatientHistoryRecords,
  saveChairsideClinicalNote,
} from "../lib/dentalService";
import { useWhisperDictation } from "../lib/whisperClient";

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

  // Chairside Clinical & Handoff Note state
  const [showChairsideForm, setShowChairsideForm] = useState(false);
  const [chairsideForm, setChairsideForm] = useState({
    procedure: "",
    toothNo: "",
    chairsideProgressNote: "",
    handoffSummary: "",
  });
  const [chairsideTelemetry, setChairsideTelemetry] = useState({
    engine: "whisper.cpp",
    dictatedFields: [],
    totalInferenceMs: 0,
    lastModelId: null,
  });
  const [chairsideStatus, setChairsideStatus] = useState("");
  const [savingChairsideNote, setSavingChairsideNote] = useState(false);
  const [activeNoteModal, setActiveNoteModal] = useState(null);

  const {
    recordingField: chairsideRecordingField,
    transcribingField: chairsideTranscribingField,
    recordingSeconds: chairsideRecordingSeconds,
    audioLevel: chairsideAudioLevel,
    toggleFieldDictation: toggleChairsideDictation,
    stopRecording: stopChairsideRecording,
  } = useWhisperDictation({
    onTranscript: (field, transcript, result) => {
      setChairsideForm((prev) => ({
        ...prev,
        [field]: prev[field] ? `${prev[field]} ${transcript}` : transcript,
      }));
      setChairsideTelemetry((prev) => ({
        engine: result?.provider || prev?.engine || "whisper.cpp",
        dictatedFields: Array.from(new Set([...(prev?.dictatedFields || []), field])),
        totalInferenceMs: (prev?.totalInferenceMs || 0) + Number(result?.durationMs || 0),
        lastModelId: result?.modelId || prev?.lastModelId || null,
      }));
    },
    onStatusChange: (msg) => {
      setChairsideStatus(msg);
    },
    onError: (errMsg) => {
      setChairsideStatus(`✕ ${errMsg}`);
    },
  });

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
          stopChairsideRecording();
          setSelectedPatientId(null);
          setVisitHistory([]);
          setSelectedRecordIds([]);
          setShowChairsideForm(false);
          setActiveNoteModal(null);
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

  const handleSaveChairsideNote = async (e) => {
    e.preventDefault();
    if (!selectedPatient || savingChairsideNote) return;

    const progressNote = chairsideForm.chairsideProgressNote.trim();
    const handoffInstructions = chairsideForm.handoffSummary.trim();
    if (!progressNote && !handoffInstructions) {
      setChairsideStatus(
        "✕ Please enter or dictate a Chairside Clinical Progress Note or Shift Handoff instruction before saving."
      );
      return;
    }

    setSavingChairsideNote(true);
    setChairsideStatus("");
    try {
      const clinicianLabel = currentUser?.name
        ? `${currentUser.name} (${currentUser.role})`
        : currentUser?.email || selectedPatient.clinician || DEFAULT_CLINICIAN;

      const res = await saveChairsideClinicalNote(selectedPatient, {
        procedure: chairsideForm.procedure.trim() || "Chairside Clinical Progress Note",
        toothNo: chairsideForm.toothNo.trim(),
        progressNote,
        handoffInstructions,
        clinician: clinicianLabel,
        dictatedWithWhisper: chairsideTelemetry.dictatedFields.length > 0,
        dictationMeta:
          chairsideTelemetry.dictatedFields.length > 0 ? { ...chairsideTelemetry } : null,
      });

      if (res?.success && res.data) {
        setVisitHistory((prev) => [res.data, ...prev.filter((r) => r.id !== res.data.id)]);
        setChairsideForm({
          procedure: "",
          toothNo: "",
          chairsideProgressNote: "",
          handoffSummary: "",
        });
        setChairsideTelemetry({
          engine: "whisper.cpp",
          dictatedFields: [],
          totalInferenceMs: 0,
          lastModelId: null,
        });
        setShowChairsideForm(false);
        setChairsideStatus(
          res.syncedToCloud
            ? "✓ Chairside clinical & handoff note saved and synced."
            : "✓ Chairside clinical & handoff note saved to clinical history."
        );
      } else {
        setChairsideStatus(`✕ ${res?.error || "Unable to save chairside clinical note."}`);
      }
    } catch (err) {
      setChairsideStatus(`✕ ${err?.message || "Unable to save chairside clinical note."}`);
    } finally {
      setSavingChairsideNote(false);
    }
  };

  // Role filtering
  const roleFilteredPatients = useMemo(() => {
    return patients.filter((p) => {
      if (normRole === "patient") {
        const userEmail = (currentUser?.email || "").toLowerCase();
        const patientEmail = (p.email || "").toLowerCase();
        return (
          (p.patientUserId && p.patientUserId === currentUser?.id) ||
          Boolean(userEmail && patientEmail && patientEmail === userEmail)
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

    const handoffRecords = visitHistory.filter(
      (r) =>
        Boolean(r.handoffInstructions && r.handoffInstructions.trim()) ||
        (r.type === "chairside_note" && Boolean(r.diagnosis && r.diagnosis.trim()))
    );
    const latestHandoffRecord = handoffRecords.reduce((best, cur) => {
      if (!best) return cur;
      const curTs = Date.parse(cur.date || "") || 0;
      const bestTs = Date.parse(best.date || "") || 0;
      return curTs > bestTs ? cur : best;
    }, null);
    const latestHandoffText = latestHandoffRecord
      ? (latestHandoffRecord.handoffInstructions || latestHandoffRecord.diagnosis || "").trim()
      : "";

    const renderChairsideNoteModal = () => {
      if (!activeNoteModal) return null;
      const modalHandoff = (
        activeNoteModal.handoffInstructions ||
        (activeNoteModal.type === "chairside_note" ? activeNoteModal.diagnosis : "") ||
        ""
      ).trim();
      const dictatedList = activeNoteModal.dictationMeta?.dictatedFields || [];

      return (
        <div
          className="confirm-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Chairside Clinical & Handoff Note"
          onClick={() => setActiveNoteModal(null)}
        >
          <div
            className="confirm-modal-card"
            style={{ maxWidth: "600px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-modal-header">
              <div>
                <h3 className="confirm-modal-title">Chairside Clinical &amp; Handoff Note</h3>
                <div style={{ fontSize: "12px", color: "#475569", marginTop: "2px" }}>
                  {selectedPatient.name} · ID #{formattedId}
                </div>
              </div>
              <button
                type="button"
                className="confirm-modal-close"
                onClick={() => setActiveNoteModal(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="confirm-modal-body" style={{ display: "grid", gap: "12px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: "8px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  fontSize: "12.5px",
                }}
              >
                <div>
                  <div style={{ color: "#64748b", fontSize: "11px", fontWeight: 700 }}>VISIT DATE</div>
                  <div style={{ fontWeight: 700, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>
                    {activeNoteModal.date || "—"}
                  </div>
                </div>
                <div>
                  <div style={{ color: "#64748b", fontSize: "11px", fontWeight: 700 }}>CLINICIAN</div>
                  <div style={{ fontWeight: 600, color: "#0f172a" }}>
                    {activeNoteModal.clinician || DEFAULT_CLINICIAN}
                  </div>
                </div>
                {activeNoteModal.toothNo && (
                  <div>
                    <div style={{ color: "#64748b", fontSize: "11px", fontWeight: 700 }}>TOOTH NO.</div>
                    <div style={{ fontWeight: 700, color: "#205136" }}>{activeNoteModal.toothNo}</div>
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#64748b", marginBottom: "4px" }}>
                  PROCEDURE / VISIT FOCUS
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: "14px", color: "#0f172a" }}>
                    {activeNoteModal.title || "Chairside Clinical Progress Note"}
                  </strong>
                  {activeNoteModal.status && (
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: "999px",
                        background:
                          activeNoteModal.status === "Whisper.cpp Dictated" ? "#eef5f0" : "#f1f5f9",
                        color:
                          activeNoteModal.status === "Whisper.cpp Dictated" ? "#205136" : "#334155",
                        border: "1px solid #cbd5e1",
                      }}
                    >
                      {activeNoteModal.status}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#64748b", marginBottom: "4px" }}>
                  CHAIRSIDE CLINICAL PROGRESS NOTE
                </div>
                <div
                  style={{
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: "10px",
                    padding: "10px 12px",
                    fontSize: "13px",
                    lineHeight: 1.5,
                    color: "#1e293b",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {activeNoteModal.notes || "No progress note text recorded."}
                </div>
              </div>

              {modalHandoff && (
                <div
                  style={{
                    background: "#fffbeb",
                    border: "1px solid #fcd34d",
                    borderRadius: "10px",
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ fontSize: "11.5px", fontWeight: 800, color: "#92400e", marginBottom: "4px" }}>
                    NEXT-VISIT SHIFT HANDOFF INSTRUCTIONS
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      lineHeight: 1.5,
                      color: "#78350f",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {modalHandoff}
                  </div>
                </div>
              )}

              {dictatedList.length > 0 && (
                <div style={{ fontSize: "11.5px", color: "#475569" }}>
                  Dictated locally via whisper.cpp ({activeNoteModal.dictationMeta?.lastModelId || "base.en-q5_1"} ·{" "}
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {activeNoteModal.dictationMeta?.totalInferenceMs || 0}ms
                  </span>
                  )
                </div>
              )}

              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="pill pill--primary"
                  style={{ height: "36px", padding: "0 18px" }}
                  onClick={() => setActiveNoteModal(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    };

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
                stopChairsideRecording();
                setSelectedPatientId(null);
                setVisitHistory([]);
                setSelectedRecordIds([]);
                setShowChairsideForm(false);
                setActiveNoteModal(null);
                setChairsideStatus("");
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

        {/* Active Clinical Handoff Banner */}
        {latestHandoffRecord && latestHandoffText && (
          <div
            role="region"
            aria-label="Active Clinical Handoff"
            style={{
              background: "#fffbeb",
              border: "1px solid #f59e0b",
              borderLeft: "4px solid #d97706",
              borderRadius: "12px",
              padding: "14px 16px",
              marginBottom: "14px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    padding: "2px 8px",
                    borderRadius: "999px",
                    background: "#fef3c7",
                    color: "#92400e",
                    border: "1px solid #fcd34d",
                  }}
                >
                  Active Clinical Handoff
                </span>
                <strong style={{ fontSize: "13.5px", color: "#78350f" }}>
                  {latestHandoffRecord.title || "Next-Visit Continuity Instructions"}
                  {latestHandoffRecord.toothNo ? ` (${latestHandoffRecord.toothNo})` : ""}
                </strong>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  fontSize: "12px",
                  color: "#92400e",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span>
                  {latestHandoffRecord.date || "Recent"} ·{" "}
                  {latestHandoffRecord.clinician || DEFAULT_CLINICIAN}
                </span>
                <button
                  type="button"
                  className="table__action table__action--review"
                  onClick={() => setActiveNoteModal(latestHandoffRecord)}
                >
                  Open Note
                </button>
              </div>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: "13px",
                lineHeight: 1.5,
                color: "#78350f",
                whiteSpace: "pre-wrap",
              }}
            >
              {latestHandoffText}
            </p>
          </div>
        )}

        {/* Collapsible Chairside Clinical & Shift Handoff Note Composer */}
        <div style={{ marginBottom: "14px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              flexWrap: "wrap",
              marginBottom: showChairsideForm ? "10px" : "0",
            }}
          >
            <button
              type="button"
              className="pill pill--primary"
              onClick={() => {
                if (showChairsideForm) stopChairsideRecording();
                setShowChairsideForm((prev) => !prev);
              }}
            >
              {showChairsideForm ? "− Hide Chairside Note Form" : "+ Chairside Clinical & Handoff Note"}
            </button>

            {chairsideStatus && (
              <span
                role="status"
                style={{
                  fontSize: "12.5px",
                  fontWeight: 600,
                  color: chairsideStatus.startsWith("✕")
                    ? "#b91c1c"
                    : chairsideStatus.startsWith("✓")
                    ? "#047857"
                    : "#0f172a",
                }}
              >
                {chairsideStatus}
              </span>
            )}
          </div>

          {showChairsideForm && (
            <form
              onSubmit={handleSaveChairsideNote}
              style={{
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                borderRadius: "14px",
                padding: "16px",
                display: "grid",
                gap: "12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                <strong style={{ fontSize: "14px", color: "#0f172a" }}>
                  Chairside Clinical &amp; Shift Handoff Note
                </strong>
                {chairsideRecordingField && (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "11.5px",
                      fontWeight: 700,
                      color: "#b91c1c",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <span>Mic Input: {chairsideAudioLevel}%</span>
                    <div
                      aria-hidden="true"
                      style={{
                        width: "72px",
                        height: "6px",
                        borderRadius: "999px",
                        background: "#fee2e2",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${chairsideAudioLevel}%`,
                          height: "100%",
                          background: "#dc2626",
                          transition: "width 80ms linear",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr",
                  gap: "12px",
                }}
              >
                <label style={{ display: "grid", gap: "4px", fontSize: "12px", fontWeight: 700, color: "#334155" }}>
                  Procedure / Visit Focus
                  <input
                    type="text"
                    value={chairsideForm.procedure}
                    onChange={(e) =>
                      setChairsideForm((prev) => ({ ...prev, procedure: e.target.value }))
                    }
                    placeholder="e.g. Composite Restoration Class II, Endo Access"
                    style={{
                      padding: "8px 10px",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      fontFamily: "inherit",
                    }}
                  />
                </label>

                <label style={{ display: "grid", gap: "4px", fontSize: "12px", fontWeight: 700, color: "#334155" }}>
                  Tooth No. (Optional)
                  <input
                    type="text"
                    value={chairsideForm.toothNo}
                    onChange={(e) =>
                      setChairsideForm((prev) => ({ ...prev, toothNo: e.target.value }))
                    }
                    placeholder="e.g. 36 or 14, 15"
                    style={{
                      padding: "8px 10px",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      fontFamily: "inherit",
                    }}
                  />
                </label>
              </div>

              <div style={{ display: "grid", gap: "5px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                    flexWrap: "wrap",
                  }}
                >
                  <label
                    htmlFor="chairside-progress-note"
                    style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}
                  >
                    Chairside Clinical Progress Note
                  </label>
                  <button
                    type="button"
                    disabled={Boolean(chairsideTranscribingField)}
                    className={`ceu-mic-btn ${
                      chairsideRecordingField === "chairsideProgressNote"
                        ? "listening"
                        : chairsideTranscribingField === "chairsideProgressNote"
                        ? "transcribing"
                        : ""
                    }`}
                    onClick={() => toggleChairsideDictation("chairsideProgressNote")}
                    title="Dictate progress note locally with OpenAI whisper.cpp"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {chairsideRecordingField === "chairsideProgressNote"
                      ? `⏹ Stop & Transcribe (${chairsideRecordingSeconds}s)`
                      : chairsideTranscribingField === "chairsideProgressNote"
                      ? "⏳ Whisper.cpp..."
                      : "🎙️ Dictate"}
                  </button>
                </div>
                <textarea
                  id="chairside-progress-note"
                  rows={3}
                  value={chairsideForm.chairsideProgressNote}
                  onChange={(e) =>
                    setChairsideForm((prev) => ({
                      ...prev,
                      chairsideProgressNote: e.target.value,
                    }))
                  }
                  placeholder="Document anesthesia, isolation, operative steps completed, materials used, and patient response..."
                  style={{
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
              </div>

              <div style={{ display: "grid", gap: "5px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                    flexWrap: "wrap",
                  }}
                >
                  <label
                    htmlFor="chairside-handoff-note"
                    style={{ fontSize: "12px", fontWeight: 700, color: "#92400e" }}
                  >
                    Next-Visit Shift Handoff Instructions
                  </label>
                  <button
                    type="button"
                    disabled={Boolean(chairsideTranscribingField)}
                    className={`ceu-mic-btn ${
                      chairsideRecordingField === "handoffSummary"
                        ? "listening"
                        : chairsideTranscribingField === "handoffSummary"
                        ? "transcribing"
                        : ""
                    }`}
                    onClick={() => toggleChairsideDictation("handoffSummary")}
                    title="Dictate shift handoff locally with OpenAI whisper.cpp"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {chairsideRecordingField === "handoffSummary"
                      ? `⏹ Stop & Transcribe (${chairsideRecordingSeconds}s)`
                      : chairsideTranscribingField === "handoffSummary"
                      ? "⏳ Whisper.cpp..."
                      : "🎙️ Dictate"}
                  </button>
                </div>
                <textarea
                  id="chairside-handoff-note"
                  rows={2}
                  value={chairsideForm.handoffSummary}
                  onChange={(e) =>
                    setChairsideForm((prev) => ({ ...prev, handoffSummary: e.target.value }))
                  }
                  placeholder="Specify pending steps, recall timing, temporary dressing precautions, or next clinician instructions..."
                  style={{
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "1px solid #fcd34d",
                    background: "#fffbeb",
                    fontSize: "13px",
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="pill"
                  onClick={() => {
                    stopChairsideRecording();
                    setShowChairsideForm(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="pill pill--primary"
                  disabled={savingChairsideNote || Boolean(chairsideTranscribingField)}
                >
                  {savingChairsideNote ? "Saving Note..." : "Save Clinical & Handoff Note"}
                </button>
              </div>
            </form>
          )}
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
                      const typeBadge =
                        rec.typeLabel ||
                        (rec.type === "chairside_note"
                          ? "Chairside Note"
                          : rec.type === "odf"
                          ? "ODF Form"
                          : "Clinical Record");
                      const shortSummary = (rec.title || rec.summary || "").trim();
                      const hasHandoff = Boolean(
                        (rec.handoffInstructions && rec.handoffInstructions.trim()) ||
                          (rec.type === "chairside_note" && rec.diagnosis && rec.diagnosis.trim())
                      );
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
                            <div>{rec.date || selectedPatient.lastVisit || "01/01/2026"}</div>
                            <div
                              style={{
                                fontSize: "11.5px",
                                fontWeight: 500,
                                color: "#475569",
                                marginTop: "2px",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                flexWrap: "wrap",
                              }}
                            >
                              <span
                                style={{
                                  fontWeight: 700,
                                  color: rec.type === "chairside_note" ? "#205136" : "#334155",
                                }}
                              >
                                {typeBadge}
                              </span>
                              {rec.toothNo && <span>· {rec.toothNo}</span>}
                              {shortSummary && (
                                <span style={{ color: "#64748b" }}>
                                  — {shortSummary.length > 52 ? `${shortSummary.slice(0, 52)}…` : shortSummary}
                                </span>
                              )}
                              {hasHandoff && (
                                <span
                                  style={{
                                    fontSize: "10px",
                                    fontWeight: 700,
                                    padding: "1px 6px",
                                    borderRadius: "999px",
                                    background: "#fffbeb",
                                    color: "#92400e",
                                    border: "1px solid #fcd34d",
                                  }}
                                >
                                  Handoff
                                </span>
                              )}
                            </div>
                          </td>
                          <td>{rec.clinician || selectedPatient.clinician || DEFAULT_CLINICIAN}</td>
                          <td className="table__actions-cell">
                            <div className="table__actions-group">
                              <button
                                type="button"
                                className="table__action table__action--review"
                                onClick={() => {
                                  if (rec.type === "chairside_note") {
                                    setActiveNoteModal(rec);
                                  } else {
                                    onViewRecords(selectedPatient, rec);
                                  }
                                }}
                                title={
                                  rec.type === "chairside_note"
                                    ? `View chairside & handoff note: ${rec.title || "record"}`
                                    : `Open full 2-page form for ${rec.title || "record"}`
                                }
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

        {renderChairsideNoteModal()}
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
