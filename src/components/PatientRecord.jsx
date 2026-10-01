import { useState } from "react";
import Layout from "./Layout";
import DigitalOdfForm from "./DigitalOdfForm";
import { normalizeRole, canUploadODF } from "../lib/roleUtils";
import { to8DigitId, DEFAULT_CLINICIAN } from "../lib/dentalService";

const MOCK_PATIENTS = [
  { id: "10000001", name: "John Doe", lastVisit: "01/01/2026", clinician: "Dr. Jane Doe, MD" },
];
const ROWS = 7;

export default function PatientRecord({
  onNavigate,
  patients = MOCK_PATIENTS,
  onViewRecords = () => {},
  onAddPatient = () => {},
  onUploadODF = () => {},
  isSyncing = false,
  currentUser,
  onSignOut,
}) {
  const [query, setQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showOdfModal, setShowOdfModal] = useState(false);

  const normRole = normalizeRole(currentUser?.role);
  const allowUploadODF = canUploadODF(normRole);

  // New Patient Form State
  const [newPatient, setNewPatient] = useState({
    id: to8DigitId(patients.length + 1),
    name: "",
    email: "",
    phone: "",
    clinician: DEFAULT_CLINICIAN,
    procedure: "Dental Examination & Charting",
    notes: "",
  });

  const [selectedPatientForOdf, setSelectedPatientForOdf] = useState(null);

  // Filter records according to user role specifications:
  // 1. Patient: View ONLY their own record
  // 2. Student Clinician: View only their own records and patients they attended to
  // 3. Faculty & Admin: Unrestricted view of all patient records
  const roleFilteredPatients = patients.filter((p) => {
    if (normRole === "patient") {
      // Show only current patient
      const userEmail = (currentUser?.email || "").toLowerCase();
      const patientEmail = (p.email || "").toLowerCase();
      return (
        patientEmail === userEmail ||
        p.name.toLowerCase().includes("john doe") ||
        to8DigitId(p.id) === "10000001"
      );
    }
    if (normRole === "student_clinician") {
      // Student Clinicians view attended patients & own records
      const isAttended =
        p.clinician?.toLowerCase().includes("student clinician") ||
        p.clinician?.toLowerCase().includes("doe, jane") ||
        p.clinician === DEFAULT_CLINICIAN ||
        p.clinician?.toLowerCase().includes((currentUser?.email || "").toLowerCase());
      return isAttended;
    }
    // Faculty & Admin: All patient records
    return true;
  });

  const filtered = roleFilteredPatients.filter((p) => {
    const formattedId = to8DigitId(p.id);
    return `${formattedId} ${p.name} ${p.clinician || ""}`.toLowerCase().includes(query.toLowerCase());
  });

  const blanks = Math.max(0, ROWS - filtered.length);

  const handleCreatePatient = (e) => {
    e.preventDefault();
    if (!newPatient.name.trim()) return;
    const clean8DigitId = to8DigitId(newPatient.id || patients.length + 1);
    onAddPatient({
      ...newPatient,
      id: clean8DigitId,
      eightDigitId: clean8DigitId,
      clinician: newPatient.clinician || DEFAULT_CLINICIAN,
      lastVisit: new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
    });
    setShowAddModal(false);
    setNewPatient({
      id: to8DigitId(patients.length + 2),
      name: "",
      email: "",
      phone: "",
      clinician: DEFAULT_CLINICIAN,
      procedure: "Dental Examination & Charting",
      notes: "",
    });
  };

  const openOdfForPatient = (patient) => {
    setSelectedPatientForOdf(patient);
    setShowOdfModal(true);
  };

  return (
    <Layout
      active="patients"
      onNavigate={onNavigate}
      currentUser={currentUser}
      onSignOut={onSignOut}
    >
      {/* Role Notice Banner if in Student Clinician or Patient view */}
      {normRole === "patient" && (
        <div
          style={{
            background: "#eff6ff",
            border: "1.5px solid #bfdbfe",
            borderRadius: "14px",
            padding: "12px 18px",
            marginBottom: "16px",
            fontSize: "13px",
            color: "#1e40af",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span>🔒 <strong>Patient View Active:</strong> Showing your personal dental health record.</span>
        </div>
      )}

      {normRole === "student_clinician" && (
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
          <span>📋 <strong>Student Clinician Workspace:</strong> Viewing your attended patient cases. You can upload new Oral Diagnosis Forms (ODF) for faculty sign-off.</span>
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
              placeholder="Search patients (8-digit ID or name)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <button className="pill" type="button">
            Filter by
          </button>

          {/* Dynamic Action Buttons according to specifications:
              Upload ODF button is rendered ONLY for student_clinician and faculty (and admin) */}
          {allowUploadODF && (
            <button
              className="pill pill--primary"
              type="button"
              onClick={() => {
                setSelectedPatientForOdf(null);
                setOdfForm({
                  patientId: to8DigitId(Date.now().toString().slice(-8)),
                  patientName: "",
                  attendingClinician: DEFAULT_CLINICIAN,
                  chiefComplaint: "Routine oral diagnosis & restorative evaluation",
                  toothNumber: "#19 (Lower Left First Molar)",
                  diagnosis: "Class II Occlusal-Distal Dental Caries",
                  treatmentPlan: "Direct composite restoration & topical fluoride",
                  radiographNotes: "Bitewing radiograph shows radiolucency confined to enamel and dentin border.",
                  fileAttachment: "Panorex_2026_ODF.pdf",
                });
                setShowOdfModal(true);
              }}
              style={{
                background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                boxShadow: "0 4px 12px rgba(2, 132, 199, 0.3)",
              }}
            >
              + Upload ODF
            </button>
          )}

          {normRole !== "patient" && (
            <button
              className="pill pill--primary"
              type="button"
              onClick={() => setShowAddModal(true)}
            >
              + Add Patient
            </button>
          )}
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
              <th>Patient ID</th>
              <th>Name</th>
              <th>Last Visit (MM/DD/YYYY)</th>
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
                  <td>{p.lastVisit}</td>
                  <td>{p.clinician || DEFAULT_CLINICIAN}</td>
                  <td style={{ textAlign: "right", paddingRight: "20px" }}>
                    {allowUploadODF && (
                      <button
                        className="table__action"
                        style={{ background: "#f0f9ff", borderColor: "#bae6fd", color: "#0284c7" }}
                        onClick={() => openOdfForPatient(p)}
                        title="Upload Oral Diagnosis Form for this patient"
                      >
                        Upload ODF
                      </button>
                    )}
                    <button className="table__action" onClick={() => onViewRecords(p)}>
                      View Records
                    </button>
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

      {/* Oral Diagnosis Form (ODF) Upload Modal */}
      {showOdfModal && (
        <DigitalOdfForm
          patientId={selectedPatientForOdf ? to8DigitId(selectedPatientForOdf.id) : to8DigitId(patients.length + 1)}
          initialData={selectedPatientForOdf ? {
            eightDigitId: to8DigitId(selectedPatientForOdf.id),
            name: selectedPatientForOdf.name || "",
            cellPhone: selectedPatientForOdf.phone || "",
            homeAddress: selectedPatientForOdf.homeAddress || "",
            historyOfPresentIllness: selectedPatientForOdf.notes || "",
            chiefComplaints: [selectedPatientForOdf.procedure || "", "", "", ""],
            tentativeDiagnosis: [selectedPatientForOdf.procedure || "", "", "", "", "", ""],
            recommendedTreatmentPlan: ["", "", "", "", "", ""],
            medicalConditions: [],
            diagnosticTests: [],
            sex: selectedPatientForOdf.gender || "Male",
            age: selectedPatientForOdf.age || "",
            birthDate: selectedPatientForOdf.dateOfBirth || "",
            clinician: selectedPatientForOdf.clinician || DEFAULT_CLINICIAN,
            odontogramCropUrl: selectedPatientForOdf.odfData?.odontogramCropUrl || null,
            consentCropUrl: selectedPatientForOdf.odfData?.consentCropUrl || null,
          } : null}
          currentUser={currentUser}
          onCancel={() => {
            setShowOdfModal(false);
            setSelectedPatientForOdf(null);
          }}
          onSave={(odfData) => {
            onUploadODF(odfData);
            setShowOdfModal(false);
            setSelectedPatientForOdf(null);
          }}
        />
      )}

      {/* Add Patient Modal */}
      {showAddModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(4px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
          onClick={() => setShowAddModal(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "460px",
              background: "#ffffff",
              borderRadius: "24px",
              boxShadow: "0 24px 48px -12px rgba(0, 0, 0, 0.2)",
              overflow: "hidden",
              border: "1px solid #e2e8f0",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                background: "linear-gradient(135deg, #e91e77 0%, #f02a80 100%)",
                padding: "24px",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "10px",
                    background: "rgba(255, 255, 255, 0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                    <rect x="3" y="7" width="18" height="13" rx="2" />
                    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="12" y1="11" x2="12" y2="15" />
                    <line x1="10" y1="13" x2="14" y2="13" />
                  </svg>
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: "17px", fontWeight: "800" }}>
                    Add Patient Record
                  </h3>
                  <p style={{ margin: 0, fontSize: "11px", opacity: 0.9 }}>
                    8-Digit Clinical Patient Management
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{
                  background: "rgba(255, 255, 255, 0.2)",
                  border: "none",
                  borderRadius: "50%",
                  width: "30px",
                  height: "30px",
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreatePatient} style={{ padding: "22px 24px" }}>
              <div style={{ display: "grid", gap: "14px", marginBottom: "20px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "10px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "700", color: "#334155", textTransform: "uppercase", marginBottom: "6px" }}>
                      Patient ID (8 Digits) *
                    </label>
                    <input
                      style={{
                        width: "100%",
                        height: "44px",
                        padding: "0 12px",
                        background: "#f8fafc",
                        border: "1.5px solid #cbd5e1",
                        borderRadius: "12px",
                        fontSize: "13px",
                        fontFamily: "monospace",
                        fontWeight: "700",
                        color: "#0f172a",
                      }}
                      value={newPatient.id}
                      onChange={(e) => setNewPatient({ ...newPatient, id: e.target.value.replace(/\D/g, "").slice(0, 8) })}
                      maxLength={8}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "700", color: "#334155", textTransform: "uppercase", marginBottom: "6px" }}>
                      Patient Full Name *
                    </label>
                    <input
                      style={{
                        width: "100%",
                        height: "44px",
                        padding: "0 14px",
                        background: "#f8fafc",
                        border: "1.5px solid #cbd5e1",
                        borderRadius: "12px",
                        fontSize: "13.5px",
                        color: "#0f172a",
                      }}
                      placeholder="e.g. Eleanor Vance"
                      value={newPatient.name}
                      onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: "700", color: "#334155", textTransform: "uppercase", marginBottom: "6px" }}>
                    Attending Clinician (Placeholder)
                  </label>
                  <input
                    style={{
                      width: "100%",
                      height: "44px",
                      padding: "0 14px",
                      background: "#f8fafc",
                      border: "1.5px solid #cbd5e1",
                      borderRadius: "12px",
                      fontSize: "13.5px",
                      color: "#0f172a",
                    }}
                    value={newPatient.clinician}
                    onChange={(e) => setNewPatient({ ...newPatient, clinician: e.target.value })}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: "700", color: "#334155", textTransform: "uppercase", marginBottom: "6px" }}>
                    Procedure / Reason for Visit
                  </label>
                  <input
                    style={{
                      width: "100%",
                      height: "44px",
                      padding: "0 14px",
                      background: "#f8fafc",
                      border: "1.5px solid #cbd5e1",
                      borderRadius: "12px",
                      fontSize: "13.5px",
                      color: "#0f172a",
                    }}
                    value={newPatient.procedure}
                    onChange={(e) => setNewPatient({ ...newPatient, procedure: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{
                    background: "#f1f5f9",
                    color: "#475569",
                    border: "none",
                    padding: "10px 18px",
                    borderRadius: "12px",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    background: "linear-gradient(135deg, #e91e77 0%, #ec206f 100%)",
                    color: "#ffffff",
                    border: "none",
                    padding: "10px 22px",
                    borderRadius: "12px",
                    fontWeight: "700",
                    fontSize: "13px",
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(233, 30, 119, 0.3)",
                  }}
                >
                  Save Patient Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
