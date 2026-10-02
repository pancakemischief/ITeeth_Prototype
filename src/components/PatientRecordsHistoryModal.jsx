import { useState, useEffect } from "react";
import { to8DigitId, DEFAULT_CLINICIAN, fetchPatientHistoryRecords, updateRecordDocumentScan } from "../lib/dentalService";
import DocumentViewerModal from "./DocumentViewerModal";

export default function PatientRecordsHistoryModal({
  patient,
  onClose = () => {},
  onOpenOdf = () => {},
  _currentUser,
}) {
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [viewingDocument, setViewingDocument] = useState(null);
  const [filterType, setFilterType] = useState("all"); // 'all' | 'odf' | 'treatment' | 'appointment'
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const eightDigitId = to8DigitId(patient?.id || patient?.eightDigitId);

  useEffect(() => {
    let active = true;
    fetchPatientHistoryRecords(patient).then((res) => {
      if (active) {
        setRecords(res);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [patient]);

  const filteredRecords = records.filter((r) => {
    if (filterType === "all") return true;
    if (filterType === "odf") return r.type === "odf";
    if (filterType === "treatment") return r.type === "treatment";
    if (filterType === "appointment") return r.type === "appointment";
    return true;
  });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(5px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "880px",
          maxHeight: "92vh",
          background: "#ffffff",
          borderRadius: "24px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid #cbd5e1",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            background: "linear-gradient(135deg, #e91e77 0%, #ec206f 100%)",
            padding: "20px 24px",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "12px",
                background: "rgba(255, 255, 255, 0.22)",
                backdropFilter: "blur(4px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "20px",
                fontWeight: "800",
              }}
            >
              🦷
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "800" }}>
                  {patient?.name || "Patient Records"}
                </h2>
                <span
                  style={{
                    background: "rgba(255, 255, 255, 0.25)",
                    padding: "3px 10px",
                    borderRadius: "999px",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    fontWeight: "700",
                    letterSpacing: "0.5px",
                  }}
                >
                  ID: {eightDigitId}
                </span>
              </div>
              <p style={{ margin: "3px 0 0", fontSize: "12px", opacity: 0.9 }}>
                Centro Escolar University • Dental Health Archive & Consultation History
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              onClick={() => setViewingDocument({ patientId: eightDigitId, ...patient })}
              style={{
                background: "rgba(255, 255, 255, 0.2)",
                color: "#ffffff",
                border: "1px solid rgba(255, 255, 255, 0.35)",
                borderRadius: "10px",
                padding: "8px 14px",
                fontSize: "12.5px",
                fontWeight: "700",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
              title="Inspect actual uploaded or official scanned CEU Oral Diagnosis Form"
            >
              <span>📄 View Scanned Document</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenOdf(patient);
              }}
              style={{
                background: "#ffffff",
                color: "#e91e77",
                border: "none",
                borderRadius: "10px",
                padding: "8px 14px",
                fontSize: "12.5px",
                fontWeight: "700",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
              }}
            >
              <span>+ New ODF for Patient</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "rgba(255, 255, 255, 0.2)",
                border: "none",
                borderRadius: "50%",
                width: "32px",
                height: "32px",
                color: "#ffffff",
                fontSize: "15px",
                fontWeight: "700",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Patient Profile Demographics Banner */}
        <div
          style={{
            background: "#f8fafc",
            borderBottom: "1.5px solid #e2e8f0",
            padding: "14px 24px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "10px",
            fontSize: "12.5px",
          }}
        >
          <div>
            <span style={{ color: "#64748b", display: "block", fontSize: "11px", fontWeight: "600", textTransform: "uppercase" }}>Attending Clinician</span>
            <strong style={{ color: "#0f172a" }}>{patient?.clinician || DEFAULT_CLINICIAN}</strong>
          </div>
          <div>
            <span style={{ color: "#64748b", display: "block", fontSize: "11px", fontWeight: "600", textTransform: "uppercase" }}>Last Visit Date</span>
            <strong style={{ color: "#0f172a" }}>{patient?.lastVisit || "01/01/2026"}</strong>
          </div>
          <div>
            <span style={{ color: "#64748b", display: "block", fontSize: "11px", fontWeight: "600", textTransform: "uppercase" }}>Contact Details</span>
            <strong style={{ color: "#0f172a" }}>{patient?.phone || patient?.email || "Recorded in chart"}</strong>
          </div>
          <div>
            <span style={{ color: "#64748b", display: "block", fontSize: "11px", fontWeight: "600", textTransform: "uppercase" }}>Total History Records</span>
            <span style={{ background: "#ecfdf5", color: "#059669", padding: "2px 8px", borderRadius: "6px", fontWeight: "700", fontSize: "12px" }}>
              {records.length} Archived Entries
            </span>
          </div>
        </div>

        {/* Modal Body: Either List View OR Selected Record Detail View */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {selectedRecord ? (
            /* ============================================================== */
            /* DRILL-DOWN RECORD DETAIL VIEW                                  */
            /* ============================================================== */
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  style={{
                    background: "#f1f5f9",
                    color: "#0f172a",
                    border: "1px solid #cbd5e1",
                    borderRadius: "10px",
                    padding: "7px 14px",
                    fontSize: "12.5px",
                    fontWeight: "700",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  ← Back to Records List
                </button>

                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => setViewingDocument(selectedRecord)}
                    style={{
                      background: "linear-gradient(135deg, #e91e77 0%, #ec206f 100%)",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      boxShadow: "0 2px 8px rgba(233, 30, 119, 0.3)",
                    }}
                  >
                    <span>📄 View Scanned Document</span>
                  </button>
                  <span
                    style={{
                      background:
                        selectedRecord.type === "odf"
                          ? "#fdf2f8"
                          : selectedRecord.type === "treatment"
                          ? "#f0fdf4"
                          : "#eff6ff",
                      color:
                        selectedRecord.type === "odf"
                          ? "#e91e77"
                          : selectedRecord.type === "treatment"
                          ? "#16a34a"
                          : "#0284c7",
                      border: "1px solid currentColor",
                      padding: "4px 10px",
                      borderRadius: "8px",
                      fontWeight: "700",
                      fontSize: "12px",
                      textTransform: "uppercase",
                    }}
                  >
                    {selectedRecord.typeLabel}
                  </span>
                  <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>
                    Encounter Date: {selectedRecord.date}
                  </span>
                </div>
              </div>

              {/* Scanned Document Hero Card */}
              <div
                style={{
                  background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
                  borderRadius: "16px",
                  padding: "16px 20px",
                  marginBottom: "18px",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "14px",
                  boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.3)",
                  border: "1px solid #334155",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <div
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "12px",
                      background: "linear-gradient(135deg, #e91e77 0%, #ec206f 100%)",
                      display: "grid",
                      placeItems: "center",
                      fontSize: "20px",
                      boxShadow: "0 4px 12px rgba(233, 30, 119, 0.35)",
                    }}
                  >
                    📄
                  </div>
                  <div>
                    <h4 style={{ margin: "0 0 3px", fontSize: "14.5px", fontWeight: "800", color: "#ffffff" }}>
                      Official Scanned CEU Oral Diagnosis Form & Records
                    </h4>
                    <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8" }}>
                      Inspect complete 2-page document: Odontogram chart, Diagnostic Tests, Treatment Plan & Signed Consent.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setViewingDocument(selectedRecord)}
                  style={{
                    background: "linear-gradient(135deg, #e91e77 0%, #ec206f 100%)",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "10px",
                    padding: "9px 18px",
                    fontSize: "13px",
                    fontWeight: "700",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "7px",
                    boxShadow: "0 4px 14px rgba(233, 30, 119, 0.4)",
                  }}
                >
                  <span>🔍 Open Full Scanned Document</span>
                </button>
              </div>

              {/* Record Summary Box */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: "16px",
                  padding: "18px 20px",
                  marginBottom: "18px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.03)",
                }}
              >
                <h3 style={{ margin: "0 0 6px", fontSize: "17px", fontWeight: "800", color: "#0f172a" }}>
                  {selectedRecord.title}
                </h3>
                <p style={{ margin: 0, fontSize: "13px", color: "#475569", lineHeight: "1.6" }}>
                  {selectedRecord.summary || selectedRecord.notes}
                </p>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "10px",
                    marginTop: "14px",
                    paddingTop: "14px",
                    borderTop: "1px solid #f1f5f9",
                    fontSize: "12px",
                  }}
                >
                  <div>
                    <span style={{ color: "#64748b" }}>Attending Clinician:</span>{" "}
                    <strong>{selectedRecord.clinician || DEFAULT_CLINICIAN}</strong>
                  </div>
                  {selectedRecord.toothNo && (
                    <div>
                      <span style={{ color: "#64748b" }}>Tooth Number:</span>{" "}
                      <strong style={{ color: "#e91e77" }}>{selectedRecord.toothNo}</strong>
                    </div>
                  )}
                  {selectedRecord.status && (
                    <div>
                      <span style={{ color: "#64748b" }}>Verification Status:</span>{" "}
                      <strong style={{ color: "#059669" }}>{selectedRecord.status}</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* If it's an ODF record, show comprehensive diagnosis sections */}
              {selectedRecord.type === "odf" && (
                <div style={{ display: "grid", gap: "16px" }}>
                  {/* Chief Complaints & HPI */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "14px", padding: "16px" }}>
                    <h4 style={{ margin: "0 0 8px", fontSize: "13.5px", fontWeight: "700", color: "#e91e77", textTransform: "uppercase" }}>
                      Chief Complaints & Case History
                    </h4>
                    <div style={{ fontSize: "13px", color: "#1e293b", lineHeight: "1.6" }}>
                      {selectedRecord.odfDetails?.chiefComplaints?.filter(Boolean)?.length > 0 ? (
                        <ul style={{ margin: "0 0 8px", paddingLeft: "20px" }}>
                          {selectedRecord.odfDetails.chiefComplaints.filter(Boolean).map((cc, i) => (
                            <li key={i}>{cc}</li>
                          ))}
                        </ul>
                      ) : (
                        <p style={{ margin: "0 0 8px" }}>{selectedRecord.summary || "Routine oral evaluation"}</p>
                      )}

                      {selectedRecord.odfDetails?.historyOfPresentIllness && (
                        <div style={{ marginTop: "8px", background: "#ffffff", padding: "10px 12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                          <strong style={{ color: "#475569", fontSize: "12px" }}>History of Present Illness (HPI):</strong>
                          <div style={{ marginTop: "2px" }}>{selectedRecord.odfDetails.historyOfPresentIllness}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Cropped Odontogram Section if available */}
                  <div style={{ background: "#ffffff", border: "2px solid #e91e77", borderRadius: "14px", padding: "16px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                      <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "800", color: "#e91e77", textTransform: "uppercase" }}>
                        Section C: Odontogram (Mouth Examination)
                      </h4>
                      <span style={{ fontSize: "11px", color: "#059669", background: "#ecfdf5", padding: "2px 8px", borderRadius: "6px", fontWeight: "700" }}>
                        Preserved Paper Chart ROI
                      </span>
                    </div>

                    {selectedRecord.odontogramCropUrl || selectedRecord.odfDetails?.odontogramCropUrl ? (
                      <div style={{ textAlign: "center", background: "#f8fafc", padding: "10px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                        <img
                          src={selectedRecord.odontogramCropUrl || selectedRecord.odfDetails?.odontogramCropUrl}
                          alt="Cropped Odontogram"
                          style={{ maxWidth: "100%", maxHeight: "360px", objectFit: "contain", borderRadius: "8px" }}
                        />
                      </div>
                    ) : (
                      <div style={{ background: "#fdf2f8", border: "1px dashed #fbcfe8", borderRadius: "10px", padding: "16px", textAlign: "center", fontSize: "12.5px", color: "#9d174d" }}>
                        Permanent dentition examination charted in physical department record. No digital image crop attached to this session.
                      </div>
                    )}
                  </div>

                  {/* Diagnoses & Treatment Plan */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "14px", padding: "16px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                      <div>
                        <h4 style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: "700", color: "#0f172a", textTransform: "uppercase" }}>
                          Tentative Diagnosis
                        </h4>
                        <div style={{ fontSize: "12.5px", color: "#334155" }}>
                          {selectedRecord.odfDetails?.tentativeDiagnosis?.filter(Boolean)?.length > 0 ? (
                            <ol style={{ margin: 0, paddingLeft: "18px" }}>
                              {selectedRecord.odfDetails.tentativeDiagnosis.filter(Boolean).map((td, i) => (
                                <li key={i}>{td}</li>
                              ))}
                            </ol>
                          ) : (
                            <p style={{ margin: 0 }}>{selectedRecord.procedure || "Clinical examination"}</p>
                          )}
                        </div>
                      </div>

                      <div>
                        <h4 style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: "700", color: "#0f172a", textTransform: "uppercase" }}>
                          Recommended Treatment Plan
                        </h4>
                        <div style={{ fontSize: "12.5px", color: "#334155" }}>
                          {selectedRecord.odfDetails?.recommendedTreatmentPlan?.filter(Boolean)?.length > 0 ? (
                            <ol style={{ margin: 0, paddingLeft: "18px" }}>
                              {selectedRecord.odfDetails.recommendedTreatmentPlan.filter(Boolean).map((tp, i) => (
                                <li key={i}>{tp}</li>
                              ))}
                            </ol>
                          ) : (
                            <p style={{ margin: 0 }}>Prophylaxis, restorative follow-up, and oral hygiene instruction.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Signed Legal Consent if available */}
                  {(selectedRecord.consentCropUrl || selectedRecord.odfDetails?.consentCropUrl) && (
                    <div style={{ background: "#ffffff", border: "2px solid #0284c7", borderRadius: "14px", padding: "16px" }}>
                      <h4 style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: "800", color: "#0284c7", textTransform: "uppercase" }}>
                        Data Privacy & Signed Consent Record (RA 10173)
                      </h4>
                      <div style={{ textAlign: "center", background: "#f8fafc", padding: "10px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                        <img
                          src={selectedRecord.consentCropUrl || selectedRecord.odfDetails?.consentCropUrl}
                          alt="Cropped Signed Consent"
                          style={{ maxWidth: "100%", maxHeight: "320px", objectFit: "contain", borderRadius: "8px" }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* If it's a standard treatment record */}
              {selectedRecord.type === "treatment" && (
                <div style={{ display: "grid", gap: "14px" }}>
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "14px", padding: "16px", fontSize: "13px", lineHeight: "1.7" }}>
                    <div><strong style={{ color: "#475569" }}>Procedure:</strong> {selectedRecord.title}</div>
                    {selectedRecord.toothNo && <div><strong style={{ color: "#475569" }}>Tooth Target:</strong> {selectedRecord.toothNo}</div>}
                    <div><strong style={{ color: "#475569" }}>Clinical Diagnosis:</strong> {selectedRecord.diagnosis || selectedRecord.title}</div>
                    <div><strong style={{ color: "#475569" }}>Clinical Progress Notes:</strong> {selectedRecord.notes || selectedRecord.summary}</div>
                    <div><strong style={{ color: "#475569" }}>Supervising Faculty:</strong> {selectedRecord.clinician}</div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ============================================================== */
            /* CHRONOLOGICAL HISTORY LIST OF RECORDS                          */
            /* ============================================================== */
            <div>
              {/* Filter Tabs */}
              <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: "6px" }}>
                  {[
                    { id: "all", label: `All Records (${records.length})` },
                    { id: "odf", label: "ODF Submissions" },
                    { id: "treatment", label: "Treatment Records" },
                    { id: "appointment", label: "Appointments" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFilterType(tab.id)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "8px",
                        border: "1px solid",
                        borderColor: filterType === tab.id ? "#e91e77" : "#cbd5e1",
                        background: filterType === tab.id ? "#fdf2f8" : "#ffffff",
                        color: filterType === tab.id ? "#e91e77" : "#475569",
                        fontWeight: filterType === tab.id ? "700" : "500",
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <span style={{ fontSize: "12px", color: "#64748b" }}>
                  Showing {filteredRecords.length} records • Click any record to inspect
                </span>
              </div>

              {/* Records List */}
              {loading ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
                  Loading patient record history from database...
                </div>
              ) : filteredRecords.length === 0 ? (
                <div
                  style={{
                    padding: "36px",
                    textAlign: "center",
                    background: "#f8fafc",
                    borderRadius: "16px",
                    border: "1.5px dashed #cbd5e1",
                  }}
                >
                  <p style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: "700", color: "#334155" }}>
                    No records found in this category
                  </p>
                  <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
                    You can upload an Oral Diagnosis Form (ODF) to start documenting clinical consultations for this patient.
                  </p>
                </div>
              ) : (
                <div style={{ display: "grid", gap: "10px" }}>
                  {filteredRecords.map((rec) => {
                    const isOdf = rec.type === "odf";
                    const isTreatment = rec.type === "treatment";
                    return (
                      <div
                        key={rec.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedRecord(rec)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") setSelectedRecord(rec);
                        }}
                        style={{
                          background: "#ffffff",
                          border: "1.5px solid #e2e8f0",
                          borderRadius: "14px",
                          padding: "14px 18px",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "14px",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "#e91e77";
                          e.currentTarget.style.boxShadow = "0 4px 16px rgba(233, 30, 119, 0.08)";
                          e.currentTarget.style.transform = "translateY(-1px)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "#e2e8f0";
                          e.currentTarget.style.boxShadow = "none";
                          e.currentTarget.style.transform = "translateY(0)";
                        }}
                      >
                        {/* Left Info */}
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", flex: 1 }}>
                          {/* Date Pill */}
                          <div
                            style={{
                              background: "#f8fafc",
                              border: "1px solid #cbd5e1",
                              borderRadius: "10px",
                              padding: "6px 10px",
                              textAlign: "center",
                              minWidth: "75px",
                            }}
                          >
                            <span style={{ display: "block", fontSize: "10px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>
                              {rec.dateFormatted?.month || "DATE"}
                            </span>
                            <span style={{ display: "block", fontSize: "15px", fontWeight: "800", color: "#0f172a" }}>
                              {rec.dateFormatted?.day || rec.date}
                            </span>
                            <span style={{ display: "block", fontSize: "10px", color: "#64748b" }}>
                              {rec.dateFormatted?.year || ""}
                            </span>
                          </div>

                          {/* Record Description */}
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
                              <span
                                style={{
                                  background: isOdf ? "#fdf2f8" : isTreatment ? "#f0fdf4" : "#eff6ff",
                                  color: isOdf ? "#e91e77" : isTreatment ? "#16a34a" : "#0284c7",
                                  padding: "2px 8px",
                                  borderRadius: "6px",
                                  fontSize: "11px",
                                  fontWeight: "700",
                                }}
                              >
                                {rec.typeLabel}
                              </span>

                              {rec.toothNo && (
                                <span style={{ background: "#fef3c7", color: "#b45309", padding: "2px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}>
                                  {rec.toothNo}
                                </span>
                              )}

                              {rec.hasOdontogram && (
                                <span style={{ background: "#e0f2fe", color: "#0369a1", padding: "2px 8px", borderRadius: "6px", fontSize: "10.5px", fontWeight: "600" }}>
                                  📷 Odontogram Scan
                                </span>
                              )}
                            </div>

                            <h4 style={{ margin: "0 0 3px", fontSize: "14px", fontWeight: "700", color: "#0f172a" }}>
                              {rec.title}
                            </h4>

                            <p style={{ margin: 0, fontSize: "12px", color: "#64748b", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                              {rec.summary || rec.notes}
                            </p>

                            <div style={{ marginTop: "6px", fontSize: "11px", color: "#94a3b8" }}>
                              Attending Clinician: <span style={{ color: "#475569", fontWeight: "600" }}>{rec.clinician || DEFAULT_CLINICIAN}</span>
                            </div>
                          </div>
                        </div>

                        {/* Right Actions: View Document & Open Record */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flexWrap: "nowrap",
                          }}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewingDocument(rec);
                            }}
                            style={{
                              background: "#ffffff",
                              border: "1.5px solid #e91e77",
                              color: "#e91e77",
                              padding: "6px 12px",
                              borderRadius: "8px",
                              fontSize: "12px",
                              fontWeight: "700",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "5px",
                              boxShadow: "0 2px 6px rgba(233, 30, 119, 0.12)",
                              whiteSpace: "nowrap",
                            }}
                            title="Inspect full scanned CEU Oral Diagnosis Form document"
                          >
                            <span>📄 View Document</span>
                          </button>

                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              color: "#475569",
                              fontSize: "12px",
                              fontWeight: "700",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span>Details</span>
                            <span style={{ fontSize: "16px" }}>→</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1.5px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#f8fafc",
          }}
        >
          <div style={{ fontSize: "12px", color: "#64748b" }}>
            Patient ID: <code style={{ fontWeight: "700", color: "#0f172a" }}>{eightDigitId}</code> • CEU Makati Dental Clinic
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: "#0f172a",
              color: "#ffffff",
              border: "none",
              borderRadius: "10px",
              padding: "8px 20px",
              fontSize: "13px",
              fontWeight: "700",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>

      {/* Scanned Document Viewer Modal */}
      {viewingDocument && (
        <DocumentViewerModal
          record={viewingDocument}
          patient={patient}
          onClose={() => setViewingDocument(null)}
          onSaveDocumentScan={async (scanData) => {
            await updateRecordDocumentScan(scanData);
            const updated = await fetchPatientHistoryRecords(patient);
            setRecords(updated);
          }}
        />
      )}
    </div>
  );
}
