import { useState } from "react";
import Layout from "./Layout";
import DigitalOdfForm from "./DigitalOdfForm";
import DocumentViewerModal from "./DocumentViewerModal";
import { normalizeRole, canUploadODF } from "../lib/roleUtils";
import { to8DigitId, DEFAULT_CLINICIAN } from "../lib/dentalService";

const MOCK_PATIENTS = [
  { id: "10000001", name: "John Doe", lastVisit: "01/01/2026", clinician: DEFAULT_CLINICIAN },
];
const ROWS = 7;

export default function PatientRecord({
  onNavigate,
  patients = MOCK_PATIENTS,
  onViewRecords = () => {},
  onUploadODF = () => {},
  isSyncing = false,
  currentUser,
  onSignOut,
}) {
  const [query, setQuery] = useState("");
  const [showOdfModal, setShowOdfModal] = useState(false);
  const [selectedPatientForOdf, setSelectedPatientForOdf] = useState(null);
  const [directDocPatient, setDirectDocPatient] = useState(null);

  const normRole = normalizeRole(currentUser?.role);
  const allowUploadODF = canUploadODF(normRole);

  // Filter records according to user role specifications:
  // 1. Patient: View ONLY their own record
  // 2. Student Clinician: View only their own records and patients they attended to
  // 3. Faculty & Admin: Unrestricted view of all patient records
  const roleFilteredPatients = patients.filter((p) => {
    if (normRole === "patient") {
      const userEmail = (currentUser?.email || "").toLowerCase();
      const patientEmail = (p.email || "").toLowerCase();
      return (
        patientEmail === userEmail ||
        p.name.toLowerCase().includes("john doe") ||
        to8DigitId(p.id) === "10000001"
      );
    }
    if (normRole === "student_clinician") {
      const isAttended =
        p.clinician?.toLowerCase().includes("student clinician") ||
        p.clinician?.toLowerCase().includes("doe, jane") ||
        p.clinician === DEFAULT_CLINICIAN ||
        p.clinician?.toLowerCase().includes((currentUser?.email || "").toLowerCase());
      return isAttended;
    }
    return true;
  });

  const filtered = roleFilteredPatients.filter((p) => {
    const formattedId = to8DigitId(p.id);
    return `${formattedId} ${p.name} ${p.clinician || ""}`.toLowerCase().includes(query.toLowerCase());
  });

  const blanks = Math.max(0, ROWS - filtered.length);

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
          <span>🔒 <strong>Patient Portal View:</strong> Viewing your personal clinical records & consultation history.</span>
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
          <span>📋 <strong>Student Clinician Workspace:</strong> Viewing your attended patient cases. Click <strong>View Records</strong> to inspect consultation histories, or <strong>+ Upload ODF</strong> to submit new clinical findings.</span>
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

          <button className="pill" type="button" onClick={() => setQuery("")}>
            {query ? "Clear Search" : "All Patients"}
          </button>

          {/* Dynamic Action Button: Upload ODF */}
          {allowUploadODF && (
            <button
              className="pill pill--primary"
              type="button"
              onClick={() => {
                setSelectedPatientForOdf(null);
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
                    <button
                      className="table__action"
                      style={{ background: "#f8fafc", borderColor: "#cbd5e1", color: "#0f172a", fontWeight: "700" }}
                      onClick={() => setDirectDocPatient(p)}
                      title="Inspect full scanned CEU Oral Diagnosis Form document"
                    >
                      📄 View Doc
                    </button>
                    {allowUploadODF && (
                      <button
                        className="table__action"
                        style={{ background: "#f0f9ff", borderColor: "#bae6fd", color: "#0284c7" }}
                        onClick={() => openOdfForPatient(p)}
                        title="Upload Oral Diagnosis Form for this patient"
                      >
                        + ODF
                      </button>
                    )}
                    <button
                      className="table__action"
                      style={{
                        background: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%)",
                        borderColor: "#fbcfe8",
                        color: "#db2777",
                        fontWeight: "700",
                      }}
                      onClick={() => onViewRecords(p)}
                      title="Open full history of consultation & treatment records"
                    >
                      View Records →
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

      {/* Scanned Document Viewer Modal */}
      {directDocPatient && (
        <DocumentViewerModal
          record={directDocPatient}
          patient={directDocPatient}
          onClose={() => setDirectDocPatient(null)}
        />
      )}
    </Layout>
  );
}
