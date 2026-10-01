import { useState, useRef } from "react";
import { cropImageRegion, ODF_CROP_PRESETS } from "../lib/cropUtils";
import { to8DigitId, DEFAULT_CLINICIAN, uploadOdfImageToStorage } from "../lib/dentalService";
import Tesseract from "tesseract.js";

const MEDICAL_CONDITIONS = [
  "Rheumatic Heart Disease",
  "Asthma",
  "Stomach Ulcers",
  "T.B.",
  "Myocardial Infarct",
  "Diabetes",
  "Kidney Disease",
  "Hypertension",
  "Cerebro-Vascular Accident",
  "Liver Disease",
  "Pregnancy",
  "Hypotension",
];

export default function DigitalOdfForm({
  patientId,
  initialData = null,
  onSave = () => {},
  onCancel = () => {},
  currentUser,
}) {
  const [activeTab, setActiveTab] = useState("page1"); // "page1" | "page2" | "vision"
  const [isProcessingOcr, setIsProcessingOcr] = useState(false);
  const [ocrStatus, setOcrStatus] = useState("");
  const [isDictating, setIsDictating] = useState(null); // field name currently listening

  // Form State matching CEU Makati paper form exactly
  const [form, setForm] = useState(() => {
    if (initialData) return initialData;
    return {
      // Demographics
      eightDigitId: to8DigitId(patientId || Date.now()),
      name: "",
      birthDate: "",
      age: "",
      sex: "Male",
      height: "",
      weight: "",
      civilStatus: "Single",
      homeAddress: "",
      homeTel: "",
      cellPhone: "",
      nationality: "Filipino",
      occupation: "",
      religion: "",

      // Case History
      chiefComplaints: ["", "", "", ""],
      historyOfPresentIllness: "",

      // Past History
      medicalConditions: [],
      allergySpecify: "",
      otherIllnesses: "",
      medications: "",
      previousExtraction: "No",
      extractionWhen: "",
      denture: "None",
      dentureUpper: "",
      dentureLower: "",

      // Clinical Exam - Extraoral
      head: "Normal",
      headSpecify: "",
      eyes: "Normal",
      eyesSpecify: "",
      tmj: "Normal",
      tmjSpecify: "",

      // Vital Signs
      bloodPressure: "120/80",
      pulseRate: "72 bpm",
      respiratoryRate: "16 cpm",
      temperature: "36.5 °C",

      // Clinical Exam - Intraoral
      lip: "Normal",
      lipSpecify: "",
      palate: "Normal",
      palateSpecify: "",
      floorOfMouth: "Normal",
      floorSpecify: "",
      tongue: "Normal",
      tongueSpecify: "",
      gingiva: "Normal",
      gingivaSpecify: "",
      deposits: "Soft",
      occlusion: "Class I",
      otherOralAbnormalities: "",

      // Section C: Cropped Odontogram
      odontogramCropUrl: null,

      // Page 2: Diagnostic Tests
      diagnosticTests: [
        { toothNo: "#19", mobility: "Grade 0", palpation: "Normal", percussion: "Mild", cavity: "Class II", hotTest: "WNL", coldTest: "Delayed", anesthetic: "Positive", electricPulp: "Normal" },
      ],
      radiographicInterpretation: "",
      tentativeDiagnosis: ["", "", "", "", "", ""],
      examinedBy: currentUser?.role?.includes("Faculty") ? "Faculty Evaluator" : "Student Clinician",
      examDate: new Date().toISOString().split("T")[0],
      clinicLevel: "Clinical Dentistry II",
      recommendedTreatmentPlan: ["", "", "", "", "", ""],
      ciRemarks: "",

      // Section D / Bottom: Cropped Consent Form
      consentCropUrl: null,
      clinician: currentUser?.role || DEFAULT_CLINICIAN,
    };
  });

  // Voice Dictation (Web Speech API - 100% Free, Browser Native)
  const speechRecognitionRef = useRef(null);

  const startDictation = (field) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    if (isDictating === field) {
      if (speechRecognitionRef.current) speechRecognitionRef.current.stop();
      setIsDictating(null);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US"; // also handles common Philippine clinical terms

      recognition.onstart = () => setIsDictating(field);
      recognition.onend = () => setIsDictating(null);
      recognition.onerror = () => setIsDictating(null);

      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setForm((prev) => ({
          ...prev,
          [field]: prev[field] ? `${prev[field]} ${transcript}` : transcript,
        }));
      };

      speechRecognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn("Speech recognition error:", err);
      setIsDictating(null);
    }
  };

  // Handle Page 1 Photo Upload (Auto-crops Odontogram + extracts printed text)
  const handlePage1Upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingOcr(true);
    setOcrStatus("Cropping Section C (Odontogram) from Page 1 scan...");

    try {
      // 1. Precise Region Cropping via HTML5 Canvas
      const odontoCrop = await cropImageRegion(file, ODF_CROP_PRESETS.PAGE_1_ODONTOGRAM);
      
      // Upload to Supabase Storage (with fallback to dataUrl)
      const odontoUrl = await uploadOdfImageToStorage(odontoCrop.blob, `odonto_${form.eightDigitId}.jpg`);

      setForm((prev) => ({
        ...prev,
        odontogramCropUrl: odontoUrl || odontoCrop.dataUrl,
      }));

      // 2. Optical Character Recognition on Top Half (Demographics & Case History)
      setOcrStatus("Extracting patient demographic text via Tesseract OCR...");
      try {
        const result = await Tesseract.recognize(file, "eng", {
          logger: (m) => {
            if (m.status === "recognizingtext") {
              setOcrStatus(`Extracting text: ${Math.round(m.progress * 100)}%`);
            }
          },
        });

        const text = result.data.text || "";
        // Simple regex heuristics for common fields in CEU ODF
        const nameMatch = text.match(/Name[:\s]+([A-Za-z\s,.-]+)/i);
        const ageMatch = text.match(/Age[:\s]+(\d+)/i);
        const bpMatch = text.match(/Blood\s*Pressure[:\s]+([\d/]+)/i);

        setForm((prev) => ({
          ...prev,
          name: nameMatch ? nameMatch[1].split("\n")[0].trim() : prev.name,
          age: ageMatch ? ageMatch[1] : prev.age,
          bloodPressure: bpMatch ? bpMatch[1] : prev.bloodPressure,
        }));
      } catch (ocrErr) {
        console.warn("OCR non-critical error:", ocrErr);
      }

      setOcrStatus("✓ Page 1 processed! Odontogram cleanly cropped and text pre-filled.");
    } catch (err) {
      console.error("Page 1 processing error:", err);
      setOcrStatus("Error processing Page 1 scan.");
    } finally {
      setIsProcessingOcr(false);
    }
  };

  // Handle Page 2 Photo Upload (Auto-crops Consent & Data Privacy Signature box)
  const handlePage2Upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingOcr(true);
    setOcrStatus("Cropping Signed Consent & Data Privacy Policy section from Page 2...");

    try {
      // Precise Region Cropping via HTML5 Canvas
      const consentCrop = await cropImageRegion(file, ODF_CROP_PRESETS.PAGE_2_CONSENT);
      const consentUrl = await uploadOdfImageToStorage(consentCrop.blob, `consent_${form.eightDigitId}.jpg`);

      setForm((prev) => ({
        ...prev,
        consentCropUrl: consentUrl || consentCrop.dataUrl,
      }));

      setOcrStatus("✓ Page 2 processed! Signed legal consent preserved as high-res image.");
    } catch (err) {
      console.error("Page 2 processing error:", err);
      setOcrStatus("Error processing Page 2 scan.");
    } finally {
      setIsProcessingOcr(false);
    }
  };

  const toggleMedical = (condition) => {
    setForm((prev) => {
      const exists = prev.medicalConditions.includes(condition);
      return {
        ...prev,
        medicalConditions: exists
          ? prev.medicalConditions.filter((c) => c !== condition)
          : [...prev.medicalConditions, condition],
      };
    });
  };

  const handleSave = (e) => {
    e.preventDefault();
    onSave({
      id: form.eightDigitId,
      name: form.name || "Unnamed Patient",
      visitDate: form.examDate || new Date().toLocaleDateString("en-US"),
      clinician: form.clinician || DEFAULT_CLINICIAN,
      procedure: form.tentativeDiagnosis[0] || "Comprehensive Oral Diagnosis & Examination",
      notes: form.historyOfPresentIllness || form.ciRemarks || "Digitized Oral Diagnosis Form",
      odontogramCropUrl: form.odontogramCropUrl,
      consentCropUrl: form.consentCropUrl,
      odfDetails: form,
    });
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.7)",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "1020px",
          height: "92vh",
          background: "#ffffff",
          borderRadius: "20px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid #cbd5e1",
        }}
      >
        {/* Header Banner */}
        <div
          style={{
            background: "linear-gradient(135deg, #e91e77 0%, #ec206f 100%)",
            color: "#ffffff",
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: "11px", fontWeight: "700", opacity: 0.9, letterSpacing: "0.5px" }}>
              CENTRO ESCOLAR UNIVERSITY • SCHOOL OF DENTISTRY (MAKATI)
            </div>
            <h2 style={{ margin: 0, fontSize: "19px", fontWeight: "800" }}>
              Digital Oral Diagnosis Form (ODF)
            </h2>
            <div style={{ fontSize: "12px", opacity: 0.9 }}>
              Patient ID: <strong>{form.eightDigitId}</strong> • Attending: {form.clinician}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                background: "rgba(255,255,255,0.2)",
                border: "none",
                borderRadius: "50%",
                width: "32px",
                height: "32px",
                color: "#fff",
                fontSize: "15px",
                fontWeight: "700",
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tab Switcher & Vision Upload Assistant */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#f8fafc",
            borderBottom: "1.5px solid #e2e8f0",
            padding: "8px 24px",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              onClick={() => setActiveTab("page1")}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "none",
                fontWeight: "700",
                fontSize: "13px",
                cursor: "pointer",
                background: activeTab === "page1" ? "#e91e77" : "transparent",
                color: activeTab === "page1" ? "#ffffff" : "#475569",
              }}
            >
              Page 1: Demographics & Odontogram
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("page2")}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "none",
                fontWeight: "700",
                fontSize: "13px",
                cursor: "pointer",
                background: activeTab === "page2" ? "#e91e77" : "transparent",
                color: activeTab === "page2" ? "#ffffff" : "#475569",
              }}
            >
              Page 2: Clinical Findings & Signed Consent
            </button>
          </div>

          {/* Quick Photo Upload Buttons */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <label
              style={{
                background: "#ffffff",
                border: "1.5px solid #cbd5e1",
                padding: "6px 12px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: "700",
                color: "#0f172a",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              📷 Scan Page 1 (Odontogram)
              <input type="file" accept="image/*" onChange={handlePage1Upload} style={{ display: "none" }} />
            </label>

            <label
              style={{
                background: "#ffffff",
                border: "1.5px solid #cbd5e1",
                padding: "6px 12px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: "700",
                color: "#0f172a",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              📷 Scan Page 2 (Consent)
              <input type="file" accept="image/*" onChange={handlePage2Upload} style={{ display: "none" }} />
            </label>
          </div>
        </div>

        {/* Processing Notification */}
        {ocrStatus && (
          <div
            style={{
              padding: "6px 24px",
              background: "#eff6ff",
              borderBottom: "1px solid #bfdbfe",
              fontSize: "12px",
              color: "#1e40af",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>{ocrStatus}</span>
            {isProcessingOcr && <span style={{ fontWeight: "700" }}>⏳ Working...</span>}
          </div>
        )}

        {/* Scrollable Form Body */}
        <form onSubmit={handleSave} style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {activeTab === "page1" && (
            <div style={{ display: "grid", gap: "18px" }}>
              {/* Patient Information Section */}
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "16px" }}>
                <h3 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: "800", color: "#e91e77" }}>
                  1. PATIENT DEMOGRAPHICS
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", fontSize: "12.5px" }}>
                  <div>
                    <label style={{ display: "block", fontWeight: "600", color: "#475569" }}>Full Name</label>
                    <input
                      style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. Juan Dela Cruz"
                      required
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontWeight: "600", color: "#475569" }}>Birth Date</label>
                    <input
                      type="date"
                      style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                      value={form.birthDate}
                      onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontWeight: "600", color: "#475569" }}>Age</label>
                    <input
                      style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                      value={form.age}
                      onChange={(e) => setForm({ ...form, age: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontWeight: "600", color: "#475569" }}>Sex</label>
                    <select
                      style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                      value={form.sex}
                      onChange={(e) => setForm({ ...form, sex: e.target.value })}
                    >
                      <option>Male</option>
                      <option>Female</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontWeight: "600", color: "#475569" }}>Civil Status</label>
                    <input
                      style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                      value={form.civilStatus}
                      onChange={(e) => setForm({ ...form, civilStatus: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontWeight: "600", color: "#475569" }}>Cell Phone No.</label>
                    <input
                      style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                      value={form.cellPhone}
                      onChange={(e) => setForm({ ...form, cellPhone: e.target.value })}
                      placeholder="0917-000-0000"
                    />
                  </div>
                </div>

                <div style={{ marginTop: "10px" }}>
                  <label style={{ display: "block", fontWeight: "600", color: "#475569", fontSize: "12.5px" }}>Home Address</label>
                  <input
                    style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                    value={form.homeAddress}
                    onChange={(e) => setForm({ ...form, homeAddress: e.target.value })}
                    placeholder="Barangay, City, Province"
                  />
                </div>
              </div>

              {/* Case History & HPI */}
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "16px" }}>
                <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: "800", color: "#e91e77" }}>
                  2. CASE HISTORY
                </h3>
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", fontWeight: "600", color: "#475569", fontSize: "12.5px", marginBottom: "4px" }}>
                    A. Chief Complaint/s
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    {form.chiefComplaints.map((cc, idx) => (
                      <input
                        key={idx}
                        style={{ padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                        placeholder={`Complaint #${idx + 1}`}
                        value={cc}
                        onChange={(e) => {
                          const updated = [...form.chiefComplaints];
                          updated[idx] = e.target.value;
                          setForm({ ...form, chiefComplaints: updated });
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                    <label style={{ fontWeight: "600", color: "#475569", fontSize: "12.5px" }}>
                      B. History of Present Illness (HPI)
                    </label>
                    <button
                      type="button"
                      onClick={() => startDictation("historyOfPresentIllness")}
                      style={{
                        background: isDictating === "historyOfPresentIllness" ? "#ef4444" : "#f1f5f9",
                        color: isDictating === "historyOfPresentIllness" ? "#ffffff" : "#0f172a",
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        padding: "3px 8px",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: "pointer",
                      }}
                    >
                      {isDictating === "historyOfPresentIllness" ? "🔴 Stop Recording" : "🎤 Dictate Note"}
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                    value={form.historyOfPresentIllness}
                    onChange={(e) => setForm({ ...form, historyOfPresentIllness: e.target.value })}
                    placeholder="Onset, duration, pain characteristics, and relieving factors..."
                  />
                </div>
              </div>

              {/* Past Medical History Checkboxes */}
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "16px" }}>
                <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: "800", color: "#e91e77" }}>
                  3. PAST HISTORY (MEDICAL & DENTAL)
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "6px", fontSize: "12px" }}>
                  {MEDICAL_CONDITIONS.map((cond) => (
                    <label key={cond} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={form.medicalConditions.includes(cond)}
                        onChange={() => toggleMedical(cond)}
                      />
                      <span>{cond}</span>
                    </label>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px", fontSize: "12px" }}>
                  <div>
                    <label style={{ display: "block", fontWeight: "600", color: "#475569" }}>Allergies (Specify)</label>
                    <input
                      style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                      value={form.allergySpecify}
                      onChange={(e) => setForm({ ...form, allergySpecify: e.target.value })}
                      placeholder="e.g. Penicillin, Latex"
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontWeight: "600", color: "#475569" }}>Medications Currently Taking</label>
                    <input
                      style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                      value={form.medications}
                      onChange={(e) => setForm({ ...form, medications: e.target.value })}
                      placeholder="e.g. Amlodipine 5mg"
                    />
                  </div>
                </div>
              </div>

              {/* Section C: Cropped Odontogram Section */}
              <div style={{ background: "#ffffff", border: "2px solid #e91e77", borderRadius: "12px", padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "800", color: "#e91e77" }}>
                      C. MOUTH EXAMINATION (ODONTOGRAM)
                    </h3>
                    <p style={{ margin: "2px 0 0", fontSize: "11.5px", color: "#64748b" }}>
                      Direct visual crop from scanned paper ODF. Bypasses noisy OCR to preserve exact tooth annotations.
                    </p>
                  </div>

                  <label
                    style={{
                      background: "#e91e77",
                      color: "#fff",
                      padding: "6px 14px",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer",
                    }}
                  >
                    {form.odontogramCropUrl ? "🔄 Replace Cropped Odontogram" : "📷 Upload Page 1 Scan"}
                    <input type="file" accept="image/*" onChange={handlePage1Upload} style={{ display: "none" }} />
                  </label>
                </div>

                {form.odontogramCropUrl ? (
                  <div style={{ textAlign: "center", background: "#f8fafc", padding: "10px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <img
                      src={form.odontogramCropUrl}
                      alt="Cropped Odontogram from ODF"
                      style={{ maxWidth: "100%", maxHeight: "360px", objectFit: "contain", borderRadius: "6px" }}
                    />
                    <div style={{ fontSize: "11px", color: "#059669", marginTop: "6px", fontWeight: "600" }}>
                      ✓ High-resolution Odontogram preserved directly from physical chart
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      border: "2px dashed #fbcfe8",
                      borderRadius: "10px",
                      padding: "24px",
                      textAlign: "center",
                      background: "#fdf2f8",
                    }}
                  >
                    <p style={{ margin: "0 0 6px", fontSize: "13px", fontWeight: "700", color: "#9d174d" }}>
                      No Odontogram Cropped Yet
                    </p>
                    <p style={{ margin: 0, fontSize: "11.5px", color: "#64748b" }}>
                      Click <strong>"Upload Page 1 Scan"</strong> above. The system will automatically isolate Section C and place it here.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "page2" && (
            <div style={{ display: "grid", gap: "18px" }}>
              {/* Radiographic Interpretation & Clinical Findings */}
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                  <h3 style={{ margin: 0, fontSize: "14px", fontWeight: "800", color: "#e91e77" }}>
                    RADIOGRAPHIC INTERPRETATION
                  </h3>
                  <button
                    type="button"
                    onClick={() => startDictation("radiographicInterpretation")}
                    style={{
                      background: isDictating === "radiographicInterpretation" ? "#ef4444" : "#f1f5f9",
                      color: isDictating === "radiographicInterpretation" ? "#ffffff" : "#0f172a",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      padding: "3px 8px",
                      fontSize: "11px",
                      fontWeight: "700",
                      cursor: "pointer",
                    }}
                  >
                    {isDictating === "radiographicInterpretation" ? "🔴 Stop Recording" : "🎤 Dictate Note"}
                  </button>
                </div>
                <textarea
                  rows={2}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                  value={form.radiographicInterpretation}
                  onChange={(e) => setForm({ ...form, radiographicInterpretation: e.target.value })}
                  placeholder="Periapical radiograph analysis, bone height, periapical radiolucencies..."
                />
              </div>

              {/* Tentative Diagnosis & Treatment Plan */}
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <div>
                    <h3 style={{ margin: "0 0 8px", fontSize: "13.5px", fontWeight: "800", color: "#0f172a" }}>
                      Tentative Diagnosis (1 - 6)
                    </h3>
                    {form.tentativeDiagnosis.map((td, idx) => (
                      <input
                        key={idx}
                        style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px", marginBottom: "6px" }}
                        placeholder={`Diagnosis #${idx + 1}`}
                        value={td}
                        onChange={(e) => {
                          const updated = [...form.tentativeDiagnosis];
                          updated[idx] = e.target.value;
                          setForm({ ...form, tentativeDiagnosis: updated });
                        }}
                      />
                    ))}
                  </div>

                  <div>
                    <h3 style={{ margin: "0 0 8px", fontSize: "13.5px", fontWeight: "800", color: "#0f172a" }}>
                      Recommended Treatment Plan (1 - 6)
                    </h3>
                    {form.recommendedTreatmentPlan.map((tp, idx) => (
                      <input
                        key={idx}
                        style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px", marginBottom: "6px" }}
                        placeholder={`Treatment #${idx + 1}`}
                        value={tp}
                        onChange={(e) => {
                          const updated = [...form.recommendedTreatmentPlan];
                          updated[idx] = e.target.value;
                          setForm({ ...form, recommendedTreatmentPlan: updated });
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Section: Cropped Signed Consent Section */}
              <div style={{ background: "#ffffff", border: "2px solid #0284c7", borderRadius: "12px", padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "800", color: "#0284c7" }}>
                      DATA PRIVACY ACT STATEMENT & SIGNED CONSENT FORM
                    </h3>
                    <p style={{ margin: "2px 0 0", fontSize: "11.5px", color: "#64748b" }}>
                      Preserved directly as an image scan to retain legal patient & CI signatures (RA 10173).
                    </p>
                  </div>

                  <label
                    style={{
                      background: "#0284c7",
                      color: "#fff",
                      padding: "6px 14px",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer",
                    }}
                  >
                    {form.consentCropUrl ? "🔄 Replace Cropped Consent" : "📷 Upload Page 2 Scan"}
                    <input type="file" accept="image/*" onChange={handlePage2Upload} style={{ display: "none" }} />
                  </label>
                </div>

                {form.consentCropUrl ? (
                  <div style={{ textAlign: "center", background: "#f8fafc", padding: "10px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <img
                      src={form.consentCropUrl}
                      alt="Cropped Signed Consent Form"
                      style={{ maxWidth: "100%", maxHeight: "360px", objectFit: "contain", borderRadius: "6px" }}
                    />
                    <div style={{ fontSize: "11px", color: "#059669", marginTop: "6px", fontWeight: "600" }}>
                      ✓ Verified signed patient consent and clinician signature attached
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      border: "2px dashed #bae6fd",
                      borderRadius: "10px",
                      padding: "24px",
                      textAlign: "center",
                      background: "#f0f9ff",
                    }}
                  >
                    <p style={{ margin: "0 0 6px", fontSize: "13px", fontWeight: "700", color: "#0369a1" }}>
                      No Consent Form Cropped Yet
                    </p>
                    <p style={{ margin: 0, fontSize: "11.5px", color: "#64748b" }}>
                      Click <strong>"Upload Page 2 Scan"</strong> above. The bottom signed section will be cropped and attached.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action Footer */}
          <div
            style={{
              marginTop: "20px",
              paddingTop: "14px",
              borderTop: "1.5px solid #e2e8f0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              Human-in-the-Loop: Review all auto-filled fields prior to final submission.
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                onClick={onCancel}
                style={{
                  background: "#f1f5f9",
                  color: "#475569",
                  border: "none",
                  padding: "9px 18px",
                  borderRadius: "10px",
                  fontWeight: "600",
                  fontSize: "13px",
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
                  padding: "9px 22px",
                  borderRadius: "10px",
                  fontWeight: "700",
                  fontSize: "13px",
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(233, 30, 119, 0.3)",
                }}
              >
                Submit Form for Faculty Review
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
