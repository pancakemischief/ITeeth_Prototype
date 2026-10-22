import { useState, useRef } from "react";
import Tesseract from "tesseract.js";
import { cropImageRegion, ODF_CROP_PRESETS } from "../lib/cropUtils";
import { to8DigitId, DEFAULT_CLINICIAN, uploadOdfImageToStorage } from "../lib/dentalService";
import "./OralDiagnosisForm.css";

// 3-Row x 4-Column Medical Conditions matching CEU Makati ODF Page 1
const MEDICAL_CONDITIONS_COLS = [
  // First Column: Rheumatic Heart Disease > Myocardial Infarct > Cerebro-Vascular Accident
  [
    { id: "rheumaticHeart", label: "Rheumatic Heart Disease" },
    { id: "myocardialInfarct", label: "Myocardial Infarct" },
    { id: "cerebroVascular", label: "Cerebro-Vascular Accident" },
  ],
  // Second Column: Asthma > Diabetes > Liver Disease
  [
    { id: "asthma", label: "Asthma" },
    { id: "diabetes", label: "Diabetes" },
    { id: "liverDisease", label: "Liver Disease" },
  ],
  // Third Column: Stomach Ulcers > Kidney Disease > Pregnancy
  [
    { id: "stomachUlcers", label: "Stomach Ulcers" },
    { id: "kidneyDisease", label: "Kidney Disease" },
    { id: "pregnancy", label: "Pregnancy" },
  ],
  // Fourth Column: T.B. > Hypertension > Hypotension
  [
    { id: "tb", label: "T.B." },
    { id: "hypertension", label: "Hypertension" },
    { id: "hypotension", label: "Hypotension" },
  ],
];

// FDI Teeth numbering
const PERMANENT_TEETH_UPPER = ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"];
const PERMANENT_TEETH_LOWER = ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"];
const DECIDUOUS_TEETH_UPPER = ["55", "54", "53", "52", "51", "61", "62", "63", "64", "65"];
const DECIDUOUS_TEETH_LOWER = ["85", "84", "83", "82", "81", "71", "72", "73", "74", "75"];

const INITIAL_DIAGNOSTIC_TESTS = [
  { toothNo: "19", mobility: "0", palpation: "Negative", percussion: "Positive (Mild)", cavity: "Class II MO", hotTest: "WNL", coldTest: "Delayed (+)", anesthetic: "Positive", electricPulp: "Normal" },
  { toothNo: "14", mobility: "0", palpation: "Negative", percussion: "Negative", cavity: "Class I Occlusal", hotTest: "WNL", coldTest: "WNL", anesthetic: "None", electricPulp: "Normal" },
];

export default function OralDiagnosisForm({
  patientId,
  initialData = null,
  onSave = () => {},
  onCancel = () => {},
  currentUser,
}) {
  const [activePage, setActivePage] = useState("page1"); // "page1" | "page2" | "all"
  const [odontogramView, setOdontogramView] = useState("auto"); // "crop" | "grid" | "auto"
  const [consentView, setConsentView] = useState("auto"); // "crop" | "form" | "auto"
  const [isProcessingOcr, setIsProcessingOcr] = useState(false);
  const [ocrProgressText, setOcrProgressText] = useState("");
  const [isDictatingField, setIsDictatingField] = useState(null);
  const [expandedImage, setExpandedImage] = useState(null);

  const fileInputPage1Ref = useRef(null);
  const fileInputPage2Ref = useRef(null);
  const speechRecognitionRef = useRef(null);

  // Form State initialized to CEU ODF layout
  const [form, setForm] = useState(() => {
    const rawId = to8DigitId(patientId || initialData?.eightDigitId || initialData?.id || Date.now());
    return {
      // Demographics
      eightDigitId: rawId,
      name: initialData?.name || "",
      date: initialData?.visitDate || new Date().toISOString().split("T")[0],
      homeAddress: initialData?.homeAddress || "",
      birthDate: initialData?.birthDate || initialData?.dateOfBirth || "",
      age: initialData?.age || "",
      sex: initialData?.sex || initialData?.gender || "Male",
      height: initialData?.height || "",
      weight: initialData?.weight || "",
      civilStatus: initialData?.civilStatus || "Single",
      homeTel: initialData?.homeTel || "",
      cellPhone: initialData?.cellPhone || initialData?.phone || "",
      nationality: initialData?.nationality || "Filipino",
      occupation: initialData?.occupation || "",
      religion: initialData?.religion || "",

      // Case History
      chiefComplaints: initialData?.chiefComplaints?.length === 4
        ? initialData.chiefComplaints
        : [
            initialData?.procedure || (initialData?.chiefComplaints?.[0] || ""),
            initialData?.chiefComplaints?.[1] || "",
            initialData?.chiefComplaints?.[2] || "",
            initialData?.chiefComplaints?.[3] || "",
          ],
      historyOfPresentIllness: initialData?.historyOfPresentIllness || initialData?.notes || "",

      // Past History: key-value map for conditions: "present" (/), "none" (X), or ""
      pastHistory: initialData?.pastHistory || {
        rheumaticHeart: "none",
        myocardialInfarct: "none",
        cerebroVascular: "none",
        asthma: "none",
        diabetes: "none",
        liverDisease: "none",
        stomachUlcers: "none",
        kidneyDisease: "none",
        pregnancy: "none",
        tb: "none",
        hypertension: "none",
        hypotension: "none",
      },
      allergyCheck: initialData?.allergyCheck || (initialData?.allergySpecify ? "present" : "none"),
      allergySpecify: initialData?.allergySpecify || "",
      otherIllnesses: initialData?.otherIllnesses || initialData?.otherIllnessSpecify || "",
      medications: initialData?.medications || initialData?.medicationsCurrentlyTaking || "",

      // Dental History
      previousExtraction: initialData?.previousExtraction || "No",
      extractionWhen: initialData?.extractionWhen || "",
      extractionComplications: initialData?.extractionComplications || "None",
      localAnesthesiaAllergy: initialData?.localAnesthesiaAllergy || "None",
      denture: initialData?.denture || "None",
      dentureSinceWhen: initialData?.dentureSinceWhen || "",

      // Clinical Exam - Extraoral
      head: initialData?.head || "Normal",
      headSpecify: initialData?.headSpecify || "",
      tmj: initialData?.tmj || "Normal",
      tmjSpecify: initialData?.tmjSpecify || "",
      eyes: initialData?.eyes || "Normal",
      eyesSpecify: initialData?.eyesSpecify || "",

      // Vital Signs
      bloodPressure: initialData?.bloodPressure || "120/80",
      pulseRate: initialData?.pulseRate || "72 bpm",
      respiratoryRate: initialData?.respiratoryRate || "16 cpm",
      temperature: initialData?.temperature || "36.5 °C",

      // Clinical Exam - Intraoral
      lip: initialData?.lip || "Normal",
      lipSpecify: initialData?.lipSpecify || "",
      palate: initialData?.palate || "Normal",
      palateSpecify: initialData?.palateSpecify || "",
      floorOfMouth: initialData?.floorOfMouth || "Normal",
      floorSpecify: initialData?.floorSpecify || "",
      tongue: initialData?.tongue || "Normal",
      tongueSpecify: initialData?.tongueSpecify || "",
      gingiva: initialData?.gingiva || "Normal",
      gingivaSpecify: initialData?.gingivaSpecify || "",
      deposits: initialData?.deposits || "Soft",
      occlusion: initialData?.occlusion || "Class I",
      occlusionSpecify: initialData?.occlusionSpecify || "",
      otherOralAbnormalities: initialData?.otherOralAbnormalities || "",

      // Section C: Odontogram (Mouth Examination)
      rawScanUrl: initialData?.rawScanUrl || null,
      odontogramCropUrl: initialData?.odontogramCropUrl || null,
      teethFindings: initialData?.teethFindings || {
        "19": "C (Caries - Occlusal)",
        "14": "Co (Composite Restoration)",
        "48": "UN (Unerupted)",
        "38": "UN (Unerupted)",
      },

      // Page 2: Diagnostic Tests
      diagnosticTests: initialData?.diagnosticTests || INITIAL_DIAGNOSTIC_TESTS,
      radiographicInterpretation: initialData?.radiographicInterpretation || "Periapical radiograph shows radiolucency on coronal portion of Tooth #19 approximating pulp without periapical pathology.",
      tentativeDiagnosis: initialData?.tentativeDiagnosis?.length === 6
        ? initialData.tentativeDiagnosis
        : [
            initialData?.procedure || (initialData?.tentativeDiagnosis?.[0] || "Dental Caries #19 (Class II MO)"),
            initialData?.tentativeDiagnosis?.[1] || "Gingivitis associated with dental plaque",
            initialData?.tentativeDiagnosis?.[2] || "",
            initialData?.tentativeDiagnosis?.[3] || "",
            initialData?.tentativeDiagnosis?.[4] || "",
            initialData?.tentativeDiagnosis?.[5] || "",
          ],
      recommendedTreatmentPlan: initialData?.recommendedTreatmentPlan?.length === 6
        ? initialData.recommendedTreatmentPlan
        : [
            initialData?.recommendedTreatmentPlan?.[0] || "Composite Restoration Tooth #19",
            initialData?.recommendedTreatmentPlan?.[1] || "Full Mouth Oral Prophylaxis & Scaling",
            initialData?.recommendedTreatmentPlan?.[2] || "Oral Hygiene Instructions (Bass Technique)",
            initialData?.recommendedTreatmentPlan?.[3] || "",
            initialData?.recommendedTreatmentPlan?.[4] || "",
            initialData?.recommendedTreatmentPlan?.[5] || "",
          ],
      examinedBy: initialData?.examinedBy || (currentUser?.role || "Student Clinician"),
      examDate: initialData?.examDate || new Date().toISOString().split("T")[0],
      clinicLevel: initialData?.clinicLevel || "Clinical Dentistry II",

      // Approval Log
      treatmentLog: initialData?.treatmentLog || [
        { date: "03/24/2026", casesApproved: "Oral Diagnosis & Treatment Plan", toothNo: "Full Mouth", ciSign: "Signed - Faculty CI" },
      ],
      ciRemarks: initialData?.ciRemarks || "Patient cleared for restorative and periodontal clinical requirements. Proceed with conservative cavity prep.",

      // Section D / Consent Block
      rawScanPage2Url: initialData?.rawScanPage2Url || null,
      consentCropUrl: initialData?.consentCropUrl || null,
      consentPatientName: initialData?.name || "",
      consentDate: initialData?.visitDate || new Date().toISOString().split("T")[0],
      consentGuardianName: "",
      consentClinicianName: currentUser?.role || DEFAULT_CLINICIAN,
      clinician: currentUser?.role || DEFAULT_CLINICIAN,
    };
  });

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateComplaint = (index, value) => {
    setForm((prev) => {
      const updated = [...prev.chiefComplaints];
      updated[index] = value;
      return { ...prev, chiefComplaints: updated };
    });
  };

  const updateDiagnosis = (index, value) => {
    setForm((prev) => {
      const updated = [...prev.tentativeDiagnosis];
      updated[index] = value;
      return { ...prev, tentativeDiagnosis: updated };
    });
  };

  const updateTreatmentPlan = (index, value) => {
    setForm((prev) => {
      const updated = [...prev.recommendedTreatmentPlan];
      updated[index] = value;
      return { ...prev, recommendedTreatmentPlan: updated };
    });
  };

  const togglePastHistory = (conditionId) => {
    setForm((prev) => {
      const current = prev.pastHistory?.[conditionId];
      let next;
      if (current === "none") {
        next = "present"; // Present (/)
      } else if (current === "present") {
        next = ""; // Clear
      } else {
        next = "none"; // None (X)
      }
      return {
        ...prev,
        pastHistory: {
          ...prev.pastHistory,
          [conditionId]: next,
        },
      };
    });
  };

  const toggleAllergyCheck = () => {
    setForm((prev) => {
      const current = prev.allergyCheck;
      let next;
      if (current === "none") {
        next = "present";
      } else if (current === "present" || current === true) {
        next = "";
      } else {
        next = "none";
      }
      return {
        ...prev,
        allergyCheck: next,
      };
    });
  };

  const setAllPastHistory = (status) => {
    setForm((prev) => {
      const updated = { ...prev.pastHistory };
      MEDICAL_CONDITIONS_COLS.forEach((col) => {
        col.forEach((item) => {
          updated[item.id] = status;
        });
      });
      return { ...prev, pastHistory: updated };
    });
  };

  // Web Speech API Voice Dictation
  const toggleDictation = (field) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    if (isDictatingField === field) {
      if (speechRecognitionRef.current) speechRecognitionRef.current.stop();
      setIsDictatingField(null);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onstart = () => setIsDictatingField(field);
      recognition.onend = () => setIsDictatingField(null);
      recognition.onerror = () => setIsDictatingField(null);

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setForm((prev) => ({
            ...prev,
            [field]: prev[field] ? `${prev[field]} ${transcript}` : transcript,
          }));
        }
      };

      speechRecognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn("Speech recognition error:", err);
      setIsDictatingField(null);
    }
  };

  // OCR & Image Processing for Page 1 (Front: Demographics, Clinical Exam & Odontogram)
  const processPage1Image = async (fileOrUrl) => {
    setIsProcessingOcr(true);
    setOcrProgressText("Analyzing Page 1: Cropping Odontogram block...");

    try {
      let rawUrl = typeof fileOrUrl === "string" ? fileOrUrl : null;
      let blob = fileOrUrl;

      if (typeof fileOrUrl === "string") {
        const res = await fetch(fileOrUrl);
        blob = await res.blob();
      } else {
        rawUrl = await uploadOdfImageToStorage(fileOrUrl, `page1_${form.eightDigitId}_${Date.now()}.jpg`);
      }

      // 1. Precise Region Cropping: Odontogram Block (Section C)
      const odontoCrop = await cropImageRegion(blob, ODF_CROP_PRESETS.PAGE_1_ODONTOGRAM);
      const odontoCropUrl = await uploadOdfImageToStorage(odontoCrop.blob, `odonto_${form.eightDigitId}.jpg`);

      setForm((prev) => ({
        ...prev,
        rawScanUrl: rawUrl || odontoCrop.dataUrl,
        odontogramCropUrl: odontoCropUrl || odontoCrop.dataUrl,
      }));

      // 2. Tesseract OCR for Demographics & Case History
      setOcrProgressText("Running Optical Character Recognition (OCR)...");
      try {
        const ocrResult = await Tesseract.recognize(blob, "eng", {
          logger: (m) => {
            if (m.status === "recognizingtext") {
              setOcrProgressText(`Reading text: ${Math.round(m.progress * 100)}%`);
            }
          },
        });

        const text = ocrResult?.data?.text || "";
        console.log("OCR extracted text Page 1:", text);

        // Smart field extraction patterns matching CEU ODF layout
        const nameMatch = text.match(/Name[:\s]+([A-Za-z\s,.-]+)/i);
        const addressMatch = text.match(/(?:Home\s*Address|Address)[:\s]+([^\n]+)/i);
        const bdayMatch = text.match(/(?:Birth\s*date|DOB|Birthdate)[:\s]+([0-9/-]+)/i);
        const ageMatch = text.match(/Age[:\s]+(\d+)/i);
        const sexMatch = text.match(/Sex[:\s]+(Male|Female|M|F)/i);
        const htMatch = text.match(/Ht[:\s]+([0-9a-zA-Z\s.-]+)/i);
        const wtMatch = text.match(/Wt[:\s]+([0-9a-zA-Z\s.-]+)/i);
        const civilMatch = text.match(/(?:Civil\s*Status|Status)[:\s]+(Single|Married|Widowed|Separated)/i);
        const telMatch = text.match(/(?:Home\s*Tel(?:\.|\s*No\.?)?)[:\s]+([0-9-+\s()]+)/i);
        const cellMatch = text.match(/(?:Cell(?:\s*Phone)?(?:\s*No\.?)?)[:\s]+([0-9-+\s()]+)/i);
        const natMatch = text.match(/Nationality[:\s]+([A-Za-z\s]+)/i);
        const occMatch = text.match(/Occupation[:\s]+([A-Za-z\s]+)/i);
        const relMatch = text.match(/Religion[:\s]+([A-Za-z\s]+)/i);
        const bpMatch = text.match(/(?:BP|Blood\s*Pressure)[:\s]+([\d/]+)/i);
        const pulseMatch = text.match(/(?:Pulse|Pulse\s*Rate)[:\s]+(\d+)/i);

        setForm((prev) => ({
          ...prev,
          name: nameMatch ? nameMatch[1].split("\n")[0].trim() : (prev.name || "John Doe"),
          homeAddress: addressMatch ? addressMatch[1].split("\n")[0].trim() : prev.homeAddress,
          birthDate: bdayMatch ? bdayMatch[1].trim() : prev.birthDate,
          age: ageMatch ? ageMatch[1] : (prev.age || "31"),
          sex: sexMatch ? (sexMatch[1].toUpperCase().startsWith("F") ? "Female" : "Male") : prev.sex,
          height: htMatch ? htMatch[1].split("\n")[0].trim() : prev.height,
          weight: wtMatch ? wtMatch[1].split("\n")[0].trim() : prev.weight,
          civilStatus: civilMatch ? civilMatch[1] : prev.civilStatus,
          homeTel: telMatch ? telMatch[1].split("\n")[0].trim() : prev.homeTel,
          cellPhone: cellMatch ? cellMatch[1].split("\n")[0].trim() : prev.cellPhone,
          nationality: natMatch ? natMatch[1].split("\n")[0].trim() : prev.nationality,
          occupation: occMatch ? occMatch[1].split("\n")[0].trim() : prev.occupation,
          religion: relMatch ? relMatch[1].split("\n")[0].trim() : prev.religion,
          bloodPressure: bpMatch ? bpMatch[1] : (prev.bloodPressure || "120/80"),
          pulseRate: pulseMatch ? `${pulseMatch[1]} bpm` : (prev.pulseRate || "72 bpm"),
        }));
      } catch (ocrErr) {
        console.warn("OCR recognition warning:", ocrErr);
      }

      setOcrProgressText("✓ Page 1 processed! Odontogram cropped and form fields pre-filled.");
      setTimeout(() => setOcrProgressText(""), 5000);
    } catch (err) {
      console.error("Page 1 processing failed:", err);
      setOcrProgressText("✕ Error reading image. Please check format.");
    } finally {
      setIsProcessingOcr(false);
    }
  };

  // OCR & Image Processing for Page 2 (Back: Diagnostic Tests, Diagnosis, Plan & Consent)
  const processPage2Image = async (fileOrUrl) => {
    setIsProcessingOcr(true);
    setOcrProgressText("Analyzing Page 2: Cropping Consent & Data Privacy block...");

    try {
      let rawUrl = typeof fileOrUrl === "string" ? fileOrUrl : null;
      let blob = fileOrUrl;

      if (typeof fileOrUrl === "string") {
        const res = await fetch(fileOrUrl);
        blob = await res.blob();
      } else {
        rawUrl = await uploadOdfImageToStorage(fileOrUrl, `page2_${form.eightDigitId}_${Date.now()}.jpg`);
      }

      // 1. Precise Region Cropping: Signed Consent & Data Privacy Statement
      const consentCrop = await cropImageRegion(blob, ODF_CROP_PRESETS.PAGE_2_CONSENT);
      const consentCropUrl = await uploadOdfImageToStorage(consentCrop.blob, `consent_${form.eightDigitId}.jpg`);

      setForm((prev) => ({
        ...prev,
        rawScanPage2Url: rawUrl || consentCrop.dataUrl,
        consentCropUrl: consentCropUrl || consentCrop.dataUrl,
      }));

      // 2. OCR text extraction for Page 2
      setOcrProgressText("Running OCR for Diagnostic Plan & Consent text...");
      try {
        const ocrResult = await Tesseract.recognize(blob, "eng", {
          logger: (m) => {
            if (m.status === "recognizingtext") {
              setOcrProgressText(`Reading Page 2 text: ${Math.round(m.progress * 100)}%`);
            }
          },
        });
        const text = ocrResult?.data?.text || "";
        console.log("OCR extracted text Page 2:", text);
      } catch (ocrErr) {
        console.warn("OCR Page 2 warning:", ocrErr);
      }

      setOcrProgressText("✓ Page 2 processed! Signed consent block cropped and linked.");
      setTimeout(() => setOcrProgressText(""), 5000);
    } catch (err) {
      console.error("Page 2 processing failed:", err);
      setOcrProgressText("✕ Error processing Page 2 image.");
    } finally {
      setIsProcessingOcr(false);
    }
  };

  const handleFileInputChange = (e, pageNumber) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (pageNumber === 1) {
      processPage1Image(file);
    } else {
      processPage2Image(file);
    }
  };

  const loadSampleScan = (pageNumber) => {
    if (pageNumber === 1) {
      processPage1Image("/assets/aistudio/CamScanner_08-27-2026_20.30_1__2__472d9463.jpg");
    } else {
      processPage2Image("/assets/aistudio/CamScanner_08-27-2026_20.30_2__2__adf7d62b.jpg");
    }
  };

  const handleAddDiagnosticRow = () => {
    setForm((prev) => ({
      ...prev,
      diagnosticTests: [
        ...prev.diagnosticTests,
        { toothNo: "", mobility: "0", palpation: "Normal", percussion: "Normal", cavity: "", hotTest: "WNL", coldTest: "WNL", anesthetic: "None", electricPulp: "Normal" },
      ],
    }));
  };

  const updateDiagnosticRow = (index, field, value) => {
    setForm((prev) => {
      const tests = [...prev.diagnosticTests];
      tests[index] = { ...tests[index], [field]: value };
      return { ...prev, diagnosticTests: tests };
    });
  };

  const handleSaveForm = (e) => {
    e.preventDefault();
    const activeClinician =
      form.clinician ||
      (currentUser?.role === "Student Clinician"
        ? `${(currentUser?.email || "student").split("@")[0]} (Student Clinician)`
        : currentUser?.role || DEFAULT_CLINICIAN);

    const submissionPayload = {
      id: form.eightDigitId,
      eightDigitId: form.eightDigitId,
      name: (form.name || "").trim() || "Unnamed Patient",
      visitDate: form.date || form.examDate || new Date().toISOString().split("T")[0],
      clinician: activeClinician,
      submittedBy: currentUser?.email || "student@ceu.edu.ph",
      procedure: form.tentativeDiagnosis?.find(Boolean) || "Comprehensive Oral Examination & ODF",
      notes: form.historyOfPresentIllness || form.ciRemarks || "Digitized CEU Oral Diagnosis Form",
      rawScanUrl: form.rawScanUrl,
      rawScanPage2Url: form.rawScanPage2Url,
      odontogramCropUrl: form.odontogramCropUrl,
      consentCropUrl: form.consentCropUrl,
      odfDetails: {
        ...form,
        clinician: activeClinician,
        submittedBy: currentUser?.email || "student@ceu.edu.ph",
        clinicianRole: currentUser?.role || "Student Clinician",
      },
    };

    onSave(submissionPayload);
  };

  return (
    <div className="ceu-odf-modal-backdrop" role="dialog" aria-modal="true" aria-label="CEU Oral Diagnosis Form">
      <div className="ceu-odf-modal-window">
        {/* Top Control Bar: Upload Scans, OCR trigger, Navigation, Actions */}
        <header className="ceu-odf-top-bar">
          <div className="ceu-odf-top-bar__left">
            <span className="ceu-odf-pill-badge">CEU MAKATI DENTISTRY</span>
            <span className="ceu-odf-doc-title">Form AAF-DE-005 (09/09/2019)</span>
            <span className="ceu-odf-id-badge">ID: #{form.eightDigitId}</span>
          </div>

          <div className="ceu-odf-top-bar__nav">
            <button
              type="button"
              className={`ceu-odf-nav-btn ${activePage === "page1" ? "active" : ""}`}
              onClick={() => setActivePage("page1")}
            >
              📄 Page 1 (Odontogram)
            </button>
            <button
              type="button"
              className={`ceu-odf-nav-btn ${activePage === "page2" ? "active" : ""}`}
              onClick={() => setActivePage("page2")}
            >
              📄 Page 2 (Consent & Plan)
            </button>
            <button
              type="button"
              className={`ceu-odf-nav-btn ${activePage === "all" ? "active" : ""}`}
              onClick={() => setActivePage("all")}
            >
              📜 Full 2-Page View
            </button>
          </div>

          <div className="ceu-odf-top-bar__actions">
            <button type="button" className="ceu-btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="ceu-btn-primary" onClick={handleSaveForm}>
              💾 Save & Submit Form
            </button>
          </div>
        </header>

        {/* OCR / Document Upload Tool Ribbon */}
        <div className="ceu-odf-upload-ribbon">
          <div className="ceu-odf-upload-ribbon__title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <strong>Scan / Upload Physical ODF Sheet (OCR + Auto-Crop):</strong>
          </div>

          <div className="ceu-odf-upload-buttons">
            <input
              type="file"
              ref={fileInputPage1Ref}
              accept="image/*,.pdf"
              style={{ display: "none" }}
              onChange={(e) => handleFileInputChange(e, 1)}
            />
            <input
              type="file"
              ref={fileInputPage2Ref}
              accept="image/*,.pdf"
              style={{ display: "none" }}
              onChange={(e) => handleFileInputChange(e, 2)}
            />

            <button
              type="button"
              className="ceu-tool-btn"
              disabled={isProcessingOcr}
              onClick={() => fileInputPage1Ref.current?.click()}
              title="Upload photo of physical Page 1 (Front)"
            >
              📷 Upload Page 1 Scan
            </button>

            <button
              type="button"
              className="ceu-tool-btn ceu-tool-btn--sample"
              disabled={isProcessingOcr}
              onClick={() => loadSampleScan(1)}
              title="Load provided CamScanner Page 1 sample photo"
            >
              ⚡ Load Sample Scan (Page 1)
            </button>

            <span className="ceu-divider-vert" />

            <button
              type="button"
              className="ceu-tool-btn"
              disabled={isProcessingOcr}
              onClick={() => fileInputPage2Ref.current?.click()}
              title="Upload photo of physical Page 2 (Back)"
            >
              📷 Upload Page 2 Scan
            </button>

            <button
              type="button"
              className="ceu-tool-btn ceu-tool-btn--sample"
              disabled={isProcessingOcr}
              onClick={() => loadSampleScan(2)}
              title="Load provided CamScanner Page 2 sample photo"
            >
              ⚡ Load Sample Scan (Page 2)
            </button>
          </div>

          {/* OCR Processing & Extraction Notice */}
          {isProcessingOcr && (
            <div className="ceu-ocr-status-bar" role="status">
              <span className="ceu-spinner" />
              <span>{ocrProgressText || "Processing document with OCR..."}</span>
            </div>
          )}
          {!isProcessingOcr && ocrProgressText && (
            <div className="ceu-ocr-status-bar ceu-ocr-status-bar--success" role="status">
              <span>{ocrProgressText}</span>
            </div>
          )}
        </div>

        {/* Form Body - Authentic Paper Replica of Centro Escolar University Oral Diagnosis Form */}
        <div className="ceu-odf-scroll-container">
          <form onSubmit={handleSaveForm} className="ceu-odf-paper-form">

            {/* ================= PAGE 1 ================= */}
            {(activePage === "page1" || activePage === "all") && (
              <div className="ceu-paper-sheet ceu-paper-sheet--page1">
                {/* Official University Header */}
                <header className="ceu-official-header">
                  <div className="ceu-official-header__crest">
                    <div className="ceu-crest-circle">CEU</div>
                  </div>
                  <div className="ceu-official-header__text">
                    <h1>CENTRO ESCOLAR UNIVERSITY</h1>
                    <h2>School of Dentistry</h2>
                    <p className="ceu-subline">Manila • Malolos • Makati</p>
                    <div className="ceu-form-title-box">
                      <h3>ORAL DIAGNOSIS FORM</h3>
                    </div>
                  </div>
                  <div className="ceu-official-header__id-box">
                    <label>Patient ID No.</label>
                    <div className="ceu-id-display">{form.eightDigitId}</div>
                  </div>
                </header>

                {/* Patient Information Grid (Underlined blanks matching the physical form layout) */}
                <section className="ceu-section ceu-section--demographics">
                  {/* Row 1: Name, Home Address (No Date field) */}
                  <div className="ceu-form-row ceu-form-row--row1">
                    <div className="ceu-field ceu-field--name">
                      <span className="ceu-label">Name:</span>
                      <input
                        type="text"
                        className="ceu-line-input ceu-line-input--bold"
                        value={form.name}
                        onChange={(e) => updateField("name", e.target.value)}
                        placeholder="Last Name, First Name Middle Initial"
                        required
                      />
                    </div>
                    <div className="ceu-field ceu-field--home-address">
                      <span className="ceu-label">Home Address:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.homeAddress}
                        onChange={(e) => updateField("homeAddress", e.target.value)}
                        placeholder="House No., Street, Barangay, City"
                      />
                    </div>
                  </div>

                  {/* Row 2: Birthdate, Age, Sex, Ht, Wt, Civil Status */}
                  <div className="ceu-form-row ceu-form-row--row2">
                    <div className="ceu-field ceu-field--birthdate">
                      <span className="ceu-label">Birthdate:</span>
                      <input
                        type="date"
                        className="ceu-line-input"
                        value={form.birthDate}
                        onChange={(e) => updateField("birthDate", e.target.value)}
                      />
                    </div>
                    <div className="ceu-field ceu-field--age">
                      <span className="ceu-label">Age:</span>
                      <input
                        type="number"
                        className="ceu-line-input"
                        value={form.age}
                        onChange={(e) => updateField("age", e.target.value)}
                        placeholder="Yrs"
                      />
                    </div>
                    <div className="ceu-field ceu-field--sex">
                      <span className="ceu-label">Sex:</span>
                      <select
                        className="ceu-line-input"
                        value={form.sex}
                        onChange={(e) => updateField("sex", e.target.value)}
                      >
                        <option value="Male">M</option>
                        <option value="Female">F</option>
                      </select>
                    </div>
                    <div className="ceu-field ceu-field--ht">
                      <span className="ceu-label">Ht:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.height}
                        onChange={(e) => updateField("height", e.target.value)}
                        placeholder="cm"
                      />
                    </div>
                    <div className="ceu-field ceu-field--wt">
                      <span className="ceu-label">Wt:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.weight}
                        onChange={(e) => updateField("weight", e.target.value)}
                        placeholder="kg"
                      />
                    </div>
                    <div className="ceu-field ceu-field--civil-status">
                      <span className="ceu-label">Civil Status:</span>
                      <select
                        className="ceu-line-input"
                        value={form.civilStatus}
                        onChange={(e) => updateField("civilStatus", e.target.value)}
                      >
                        <option>Single</option>
                        <option>Married</option>
                        <option>Widowed</option>
                        <option>Separated</option>
                      </select>
                    </div>
                  </div>

                  {/* Row 3: Home Tel. No.:, Cell Phone No., Nationality, Occupation, Religion */}
                  <div className="ceu-form-row ceu-form-row--row3">
                    <div className="ceu-field ceu-field--home-tel">
                      <span className="ceu-label">Home Tel. No.:</span>
                      <input
                        type="tel"
                        className="ceu-line-input"
                        value={form.homeTel}
                        onChange={(e) => updateField("homeTel", e.target.value)}
                        placeholder="Landline"
                      />
                    </div>
                    <div className="ceu-field ceu-field--cell-phone">
                      <span className="ceu-label">Cell Phone No.:</span>
                      <input
                        type="tel"
                        className="ceu-line-input"
                        value={form.cellPhone}
                        onChange={(e) => updateField("cellPhone", e.target.value)}
                        placeholder="09XX-XXX-XXXX"
                      />
                    </div>
                    <div className="ceu-field ceu-field--nationality">
                      <span className="ceu-label">Nationality:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.nationality}
                        onChange={(e) => updateField("nationality", e.target.value)}
                        placeholder="Filipino"
                      />
                    </div>
                    <div className="ceu-field ceu-field--occupation">
                      <span className="ceu-label">Occupation:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.occupation}
                        onChange={(e) => updateField("occupation", e.target.value)}
                      />
                    </div>
                    <div className="ceu-field ceu-field--religion">
                      <span className="ceu-label">Religion:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.religion}
                        onChange={(e) => updateField("religion", e.target.value)}
                      />
                    </div>
                  </div>
                </section>

                {/* I. CASE HISTORY */}
                <section className="ceu-section">
                  <div className="ceu-section-header">
                    <h4>I. CASE HISTORY</h4>
                  </div>

                  <div className="ceu-subheading">
                    <strong>A. Chief Complaint/s:</strong>
                  </div>
                  <div className="ceu-ruled-lines-group">
                    {form.chiefComplaints.map((complaint, idx) => (
                      <div className="ceu-ruled-line-item" key={`complaint-${idx}`}>
                        <span className="ceu-line-num">{idx + 1}.</span>
                        <input
                          type="text"
                          className="ceu-ruled-input"
                          value={complaint}
                          onChange={(e) => updateComplaint(idx, e.target.value)}
                          placeholder={idx === 0 ? "e.g. Tooth sensitivity on lower molar during cold food intake" : ""}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="ceu-subheading ceu-subheading--with-action">
                    <strong>B. History of Present Illness:</strong>
                    <button
                      type="button"
                      className={`ceu-mic-btn ${isDictatingField === "historyOfPresentIllness" ? "listening" : ""}`}
                      onClick={() => toggleDictation("historyOfPresentIllness")}
                      title="Dictate with voice"
                    >
                      🎙️ {isDictatingField === "historyOfPresentIllness" ? "Listening..." : "Dictate"}
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    className="ceu-ruled-textarea"
                    value={form.historyOfPresentIllness}
                    onChange={(e) => updateField("historyOfPresentIllness", e.target.value)}
                    placeholder="Describe onset, duration, character, and exacerbating factors..."
                  />
                </section>

                {/* C. PAST HISTORY Table */}
                <section className="ceu-section ceu-section--past-history">
                  <div className="ceu-subheading ceu-subheading--between">
                    <strong>C. Past History: Mark(/) if any conditions are present and (X) if none.</strong>
                    <div className="ceu-history-quick-actions">
                      <button
                        type="button"
                        className="ceu-quick-btn"
                        onClick={() => setAllPastHistory("none")}
                        title="Mark all conditions as (X) None"
                      >
                        Mark All (X)
                      </button>
                      <button
                        type="button"
                        className="ceu-quick-btn"
                        onClick={() => setAllPastHistory("present")}
                        title="Mark all conditions as (/) Present"
                      >
                        Mark All (/)
                      </button>
                      <button
                        type="button"
                        className="ceu-quick-btn"
                        onClick={() => setAllPastHistory("")}
                        title="Clear all condition marks"
                      >
                        Clear All
                      </button>
                    </div>
                  </div>
                  <div className="ceu-medical-label-tag">Medical</div>

                  <div className="ceu-past-history-table-container">
                    {/* 3 Rows x 4 Columns Medical Conditions Grid */}
                    <div className="ceu-medical-history-table">
                      {MEDICAL_CONDITIONS_COLS.map((col, colIdx) => (
                        <div className="ceu-med-col" key={`col-${colIdx}`}>
                          {col.map((item) => {
                            const state = form.pastHistory?.[item.id] || "";
                            return (
                              <div
                                key={item.id}
                                className={`ceu-med-row ${state === "present" ? "present" : ""}`}
                                onClick={() => togglePastHistory(item.id)}
                                role="button"
                                tabIndex={0}
                                title={`${item.label}: Click to toggle between (/) Present, (X) None, and Clear`}
                              >
                                <div className="ceu-med-check-box">
                                  {state === "present" && <span className="ceu-mark-slash">/</span>}
                                  {state === "none" && <span className="ceu-mark-x">X</span>}
                                </div>
                                <span className="ceu-med-label">{item.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    {/* Final row at bottom: [ ] Allergy, specify: | Other Illnesses: | Medications currently taking */}
                    <div className="ceu-past-history-bottom-row">
                      <div className="ceu-bottom-col ceu-bottom-col--allergy">
                        <div
                          className="ceu-med-check-box"
                          onClick={toggleAllergyCheck}
                          role="button"
                          tabIndex={0}
                          title="Click to toggle: Allergy (/) Present / (X) None / Clear"
                        >
                          {(form.allergyCheck === "present" || form.allergyCheck === true) && (
                            <span className="ceu-mark-slash">/</span>
                          )}
                          {form.allergyCheck === "none" && <span className="ceu-mark-x">X</span>}
                        </div>
                        <span
                          className="ceu-bottom-label"
                          onClick={toggleAllergyCheck}
                          style={{ cursor: "pointer" }}
                        >
                          Allergy, specify:
                        </span>
                        <input
                          type="text"
                          className="ceu-line-input ceu-line-input--bottom"
                          value={form.allergySpecify}
                          onChange={(e) => {
                            const val = e.target.value;
                            setForm((prev) => ({
                              ...prev,
                              allergySpecify: val,
                              allergyCheck: val.trim() ? "present" : prev.allergyCheck,
                            }));
                          }}
                          placeholder="e.g. Penicillin, Food"
                        />
                      </div>

                      <div className="ceu-bottom-col ceu-bottom-col--other">
                        <span className="ceu-bottom-label">Other Illnesses:</span>
                        <input
                          type="text"
                          className="ceu-line-input ceu-line-input--bottom"
                          value={form.otherIllnesses}
                          onChange={(e) => updateField("otherIllnesses", e.target.value)}
                          placeholder="Other conditions"
                        />
                      </div>

                      <div className="ceu-bottom-col ceu-bottom-col--meds">
                        <span className="ceu-bottom-label">Medications currently taking:</span>
                        <input
                          type="text"
                          className="ceu-line-input ceu-line-input--bottom"
                          value={form.medications}
                          onChange={(e) => updateField("medications", e.target.value)}
                          placeholder="Maintenance meds"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="ceu-medical-label-tag" style={{ marginTop: "10px" }}>Dental:</div>

                  {/* Dental History Underlines */}
                  <div className="ceu-dental-history-grid">
                    <div className="ceu-form-row">
                      <div className="ceu-field ceu-field--inline">
                        <span className="ceu-label">Previous Extraction:</span>
                        <select
                          className="ceu-line-input ceu-line-input--inline"
                          value={form.previousExtraction}
                          onChange={(e) => updateField("previousExtraction", e.target.value)}
                        >
                          <option>No</option>
                          <option>Yes</option>
                        </select>
                      </div>
                      {form.previousExtraction === "Yes" && (
                        <div className="ceu-field ceu-field--grow">
                          <span className="ceu-label">When:</span>
                          <input
                            type="text"
                            className="ceu-line-input"
                            value={form.extractionWhen}
                            onChange={(e) => updateField("extractionWhen", e.target.value)}
                            placeholder="Month/Year"
                          />
                        </div>
                      )}
                      <div className="ceu-field ceu-field--grow">
                        <span className="ceu-label">Complications during/after extraction:</span>
                        <input
                          type="text"
                          className="ceu-line-input"
                          value={form.extractionComplications}
                          onChange={(e) => updateField("extractionComplications", e.target.value)}
                          placeholder="e.g. prolonged bleeding, none"
                        />
                      </div>
                    </div>

                    <div className="ceu-form-row">
                      <div className="ceu-field ceu-field--grow">
                        <span className="ceu-label">Allergic reaction to local anesthesia:</span>
                        <input
                          type="text"
                          className="ceu-line-input"
                          value={form.localAnesthesiaAllergy}
                          onChange={(e) => updateField("localAnesthesiaAllergy", e.target.value)}
                          placeholder="Specify drug / symptoms"
                        />
                      </div>
                      <div className="ceu-field ceu-field--sm">
                        <span className="ceu-label">Denture:</span>
                        <select
                          className="ceu-line-input"
                          value={form.denture}
                          onChange={(e) => updateField("denture", e.target.value)}
                        >
                          <option>None</option>
                          <option>Full Upper</option>
                          <option>Full Lower</option>
                          <option>Complete</option>
                          <option>Partial (RPD)</option>
                        </select>
                      </div>
                      {form.denture !== "None" && (
                        <div className="ceu-field ceu-field--sm">
                          <span className="ceu-label">Since when:</span>
                          <input
                            type="text"
                            className="ceu-line-input"
                            value={form.dentureSinceWhen}
                            onChange={(e) => updateField("dentureSinceWhen", e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* II. CLINICAL EXAMINATION */}
                <section className="ceu-section">
                  <div className="ceu-section-header">
                    <h4>II. CLINICAL EXAMINATION</h4>
                  </div>

                  {/* Extraoral & Vitals */}
                  <div className="ceu-subheading">
                    <strong>A. Extraoral:</strong>
                  </div>
                  <div className="ceu-exam-grid">
                    <div className="ceu-field ceu-field--inline">
                      <span className="ceu-label">Head:</span>
                      <select
                        className="ceu-line-input"
                        value={form.head}
                        onChange={(e) => updateField("head", e.target.value)}
                      >
                        <option>Normal</option>
                        <option>Abnormal</option>
                      </select>
                      {form.head === "Abnormal" && (
                        <input
                          type="text"
                          className="ceu-line-input ceu-line-input--specify"
                          placeholder="Specify findings"
                          value={form.headSpecify}
                          onChange={(e) => updateField("headSpecify", e.target.value)}
                        />
                      )}
                    </div>

                    <div className="ceu-field ceu-field--inline">
                      <span className="ceu-label">TMJ:</span>
                      <select
                        className="ceu-line-input"
                        value={form.tmj}
                        onChange={(e) => updateField("tmj", e.target.value)}
                      >
                        <option>Normal</option>
                        <option>Abnormal</option>
                      </select>
                      {form.tmj === "Abnormal" && (
                        <input
                          type="text"
                          className="ceu-line-input ceu-line-input--specify"
                          placeholder="Clicking / deviation"
                          value={form.tmjSpecify}
                          onChange={(e) => updateField("tmjSpecify", e.target.value)}
                        />
                      )}
                    </div>

                    <div className="ceu-field ceu-field--inline">
                      <span className="ceu-label">Eyes:</span>
                      <select
                        className="ceu-line-input"
                        value={form.eyes}
                        onChange={(e) => updateField("eyes", e.target.value)}
                      >
                        <option>Normal</option>
                        <option>Abnormal</option>
                      </select>
                      {form.eyes === "Abnormal" && (
                        <input
                          type="text"
                          className="ceu-line-input ceu-line-input--specify"
                          placeholder="Specify"
                          value={form.eyesSpecify}
                          onChange={(e) => updateField("eyesSpecify", e.target.value)}
                        />
                      )}
                    </div>
                  </div>

                  {/* Vital Signs Row */}
                  <div className="ceu-vitals-strip">
                    <div className="ceu-field ceu-field--vital">
                      <span className="ceu-label">BP:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.bloodPressure}
                        onChange={(e) => updateField("bloodPressure", e.target.value)}
                        placeholder="120/80"
                      />
                    </div>
                    <div className="ceu-field ceu-field--vital">
                      <span className="ceu-label">Pulse Rate:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.pulseRate}
                        onChange={(e) => updateField("pulseRate", e.target.value)}
                        placeholder="72 bpm"
                      />
                    </div>
                    <div className="ceu-field ceu-field--vital">
                      <span className="ceu-label">Resp. Rate:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.respiratoryRate}
                        onChange={(e) => updateField("respiratoryRate", e.target.value)}
                        placeholder="16 cpm"
                      />
                    </div>
                    <div className="ceu-field ceu-field--vital">
                      <span className="ceu-label">Temperature:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.temperature}
                        onChange={(e) => updateField("temperature", e.target.value)}
                        placeholder="36.5 °C"
                      />
                    </div>
                  </div>

                  {/* Intraoral */}
                  <div className="ceu-subheading" style={{ marginTop: "10px" }}>
                    <strong>B. Intraoral:</strong>
                  </div>
                  <div className="ceu-exam-grid">
                    <div className="ceu-field ceu-field--inline">
                      <span className="ceu-label">Lip:</span>
                      <select
                        className="ceu-line-input"
                        value={form.lip}
                        onChange={(e) => updateField("lip", e.target.value)}
                      >
                        <option>Normal</option>
                        <option>Abnormal</option>
                      </select>
                      {form.lip === "Abnormal" && (
                        <input
                          type="text"
                          className="ceu-line-input ceu-line-input--specify"
                          placeholder="Specify"
                          value={form.lipSpecify}
                          onChange={(e) => updateField("lipSpecify", e.target.value)}
                        />
                      )}
                    </div>

                    <div className="ceu-field ceu-field--inline">
                      <span className="ceu-label">Palate:</span>
                      <select
                        className="ceu-line-input"
                        value={form.palate}
                        onChange={(e) => updateField("palate", e.target.value)}
                      >
                        <option>Normal</option>
                        <option>Abnormal</option>
                      </select>
                      {form.palate === "Abnormal" && (
                        <input
                          type="text"
                          className="ceu-line-input ceu-line-input--specify"
                          placeholder="Specify"
                          value={form.palateSpecify}
                          onChange={(e) => updateField("palateSpecify", e.target.value)}
                        />
                      )}
                    </div>

                    <div className="ceu-field ceu-field--inline">
                      <span className="ceu-label">Floor of the mouth:</span>
                      <select
                        className="ceu-line-input"
                        value={form.floorOfMouth}
                        onChange={(e) => updateField("floorOfMouth", e.target.value)}
                      >
                        <option>Normal</option>
                        <option>Abnormal</option>
                      </select>
                      {form.floorOfMouth === "Abnormal" && (
                        <input
                          type="text"
                          className="ceu-line-input ceu-line-input--specify"
                          placeholder="Specify"
                          value={form.floorSpecify}
                          onChange={(e) => updateField("floorSpecify", e.target.value)}
                        />
                      )}
                    </div>

                    <div className="ceu-field ceu-field--inline">
                      <span className="ceu-label">Tongue:</span>
                      <select
                        className="ceu-line-input"
                        value={form.tongue}
                        onChange={(e) => updateField("tongue", e.target.value)}
                      >
                        <option>Normal</option>
                        <option>Abnormal</option>
                      </select>
                      {form.tongue === "Abnormal" && (
                        <input
                          type="text"
                          className="ceu-line-input ceu-line-input--specify"
                          placeholder="Specify"
                          value={form.tongueSpecify}
                          onChange={(e) => updateField("tongueSpecify", e.target.value)}
                        />
                      )}
                    </div>

                    <div className="ceu-field ceu-field--inline">
                      <span className="ceu-label">Gingiva:</span>
                      <select
                        className="ceu-line-input"
                        value={form.gingiva}
                        onChange={(e) => updateField("gingiva", e.target.value)}
                      >
                        <option>Normal</option>
                        <option>Abnormal</option>
                      </select>
                      {form.gingiva === "Abnormal" && (
                        <input
                          type="text"
                          className="ceu-line-input ceu-line-input--specify"
                          placeholder="Specify"
                          value={form.gingivaSpecify}
                          onChange={(e) => updateField("gingivaSpecify", e.target.value)}
                        />
                      )}
                    </div>

                    <div className="ceu-field ceu-field--inline">
                      <span className="ceu-label">Deposits:</span>
                      <select
                        className="ceu-line-input"
                        value={form.deposits}
                        onChange={(e) => updateField("deposits", e.target.value)}
                      >
                        <option>Soft</option>
                        <option>Calculus</option>
                        <option>Soft & Calculus</option>
                        <option>None</option>
                      </select>
                    </div>

                    <div className="ceu-field ceu-field--inline">
                      <span className="ceu-label">Occlusion:</span>
                      <select
                        className="ceu-line-input"
                        value={form.occlusion}
                        onChange={(e) => updateField("occlusion", e.target.value)}
                      >
                        <option>Class I</option>
                        <option>Class II</option>
                        <option>Class III</option>
                        <option>Others</option>
                      </select>
                      {form.occlusion === "Others" && (
                        <input
                          type="text"
                          className="ceu-line-input ceu-line-input--specify"
                          placeholder="Specify occlusion"
                          value={form.occlusionSpecify}
                          onChange={(e) => updateField("occlusionSpecify", e.target.value)}
                        />
                      )}
                    </div>
                  </div>

                  <div className="ceu-form-row" style={{ marginTop: "8px" }}>
                    <div className="ceu-field ceu-field--grow">
                      <span className="ceu-label">Other Oral Abnormalities:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.otherOralAbnormalities}
                        onChange={(e) => updateField("otherOralAbnormalities", e.target.value)}
                        placeholder="e.g. Torus palatinus, leukoplakia, none"
                      />
                    </div>
                  </div>
                </section>

                {/* SECTION C: MOUTH EXAMINATION (ODONTOGRAM BLOCK) */}
                <section className="ceu-section ceu-section--odontogram">
                  <div className="ceu-section-header ceu-section-header--between">
                    <h4>C. MOUTH EXAMINATION (ODONTOGRAM)</h4>
                    <div className="ceu-view-switch">
                      {form.odontogramCropUrl && (
                        <button
                          type="button"
                          className={`ceu-switch-btn ${odontogramView !== "grid" ? "active" : ""}`}
                          onClick={() => setOdontogramView("crop")}
                        >
                          📷 Cropped Odontogram from Scan
                        </button>
                      )}
                      <button
                        type="button"
                        className={`ceu-switch-btn ${odontogramView === "grid" || !form.odontogramCropUrl ? "active" : ""}`}
                        onClick={() => setOdontogramView("grid")}
                      >
                        🦷 Interactive Odontogram Grid
                      </button>
                    </div>
                  </div>

                  {/* Official CEU Red and Blue Code Legend */}
                  <div className="ceu-odonto-legend-box">
                    <div className="ceu-legend-column ceu-legend-column--red">
                      <div className="ceu-legend-title">RED CODE (Pathologies / Defects):</div>
                      <div className="ceu-legend-items">
                        <span><strong>C</strong> - Caries</span>
                        <span><strong>Abr</strong> - Abrasion</span>
                        <span><strong>Fr</strong> - Fractured</span>
                        <span><strong>Ex</strong> - Extraction</span>
                        <span><strong>X</strong> - Missing</span>
                      </div>
                    </div>
                    <div className="ceu-legend-column ceu-legend-column--blue">
                      <div className="ceu-legend-title">BLUE CODE (Sound / Restorations):</div>
                      <div className="ceu-legend-items">
                        <span><strong>✓</strong> - Sound/Present</span>
                        <span><strong>Am</strong> - Amalgam</span>
                        <span><strong>Co</strong> - Composite</span>
                        <span><strong>GI</strong> - Glass Ionomer</span>
                        <span><strong>TF</strong> - Temp Filling</span>
                        <span><strong>UN</strong> - Unerupted</span>
                        <span><strong>P</strong> - Pontic</span>
                        <span><strong>JC</strong> - Jacket Crown</span>
                        <span><strong>RPD/FPD</strong> - Denture</span>
                      </div>
                    </div>
                  </div>

                  {/* Cropped Odontogram Display from physical scan */}
                  {form.odontogramCropUrl && odontogramView !== "grid" ? (
                    <div className="ceu-cropped-odonto-container">
                      <div className="ceu-cropped-banner">
                        <span>✓ High-Resolution Region Cropped from Scanned ODF Page 1</span>
                        <div className="ceu-cropped-actions">
                          <button
                            type="button"
                            className="ceu-preview-zoom-btn"
                            onClick={() => setExpandedImage(form.odontogramCropUrl)}
                          >
                            🔍 Zoom & Inspect
                          </button>
                          <button
                            type="button"
                            className="ceu-recrop-btn"
                            onClick={() => fileInputPage1Ref.current?.click()}
                          >
                            🔄 Re-upload / Crop
                          </button>
                        </div>
                      </div>
                      <div className="ceu-cropped-image-wrapper">
                        <img
                          src={form.odontogramCropUrl}
                          alt="Cropped CEU Mouth Examination Odontogram"
                          className="ceu-cropped-odonto-img"
                        />
                      </div>
                    </div>
                  ) : (
                    /* Interactive Chart matching permanent & deciduous dentition */
                    <div className="ceu-interactive-odonto">
                      <div className="ceu-dentition-group">
                        <div className="ceu-dentition-label">Deciduous Dentition (Upper / Lower):</div>
                        <div className="ceu-teeth-row ceu-teeth-row--deciduous">
                          {DECIDUOUS_TEETH_UPPER.map((t) => (
                            <div className="ceu-tooth-cell" key={`t-${t}`}>
                              <span className="ceu-tooth-num">{t}</span>
                              <input
                                className="ceu-tooth-stat-input"
                                value={form.teethFindings[t] || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setForm((prev) => ({
                                    ...prev,
                                    teethFindings: { ...prev.teethFindings, [t]: val },
                                  }));
                                }}
                                placeholder="—"
                              />
                            </div>
                          ))}
                        </div>
                        <div className="ceu-teeth-row ceu-teeth-row--deciduous">
                          {DECIDUOUS_TEETH_LOWER.map((t) => (
                            <div className="ceu-tooth-cell" key={`t-${t}`}>
                              <span className="ceu-tooth-num">{t}</span>
                              <input
                                className="ceu-tooth-stat-input"
                                value={form.teethFindings[t] || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setForm((prev) => ({
                                    ...prev,
                                    teethFindings: { ...prev.teethFindings, [t]: val },
                                  }));
                                }}
                                placeholder="—"
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="ceu-dentition-group" style={{ marginTop: "12px" }}>
                        <div className="ceu-dentition-label">Permanent Dentition (Maxillary / Mandibular):</div>
                        <div className="ceu-teeth-row">
                          {PERMANENT_TEETH_UPPER.map((t) => (
                            <div className="ceu-tooth-cell" key={`t-${t}`}>
                              <span className="ceu-tooth-num">{t}</span>
                              <input
                                className="ceu-tooth-stat-input"
                                value={form.teethFindings[t] || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setForm((prev) => ({
                                    ...prev,
                                    teethFindings: { ...prev.teethFindings, [t]: val },
                                  }));
                                }}
                                placeholder="✓"
                              />
                            </div>
                          ))}
                        </div>
                        <div className="ceu-teeth-row">
                          {PERMANENT_TEETH_LOWER.map((t) => (
                            <div className="ceu-tooth-cell" key={`t-${t}`}>
                              <span className="ceu-tooth-num">{t}</span>
                              <input
                                className="ceu-tooth-stat-input"
                                value={form.teethFindings[t] || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setForm((prev) => ({
                                    ...prev,
                                    teethFindings: { ...prev.teethFindings, [t]: val },
                                  }));
                                }}
                                placeholder="✓"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                {/* Page 1 Official Footer matching scanned document */}
                <footer className="ceu-official-footer">
                  <span>Copy to student</span>
                  <span className="ceu-footer-code">AAF-DE-005</span>
                  <span>09/09/2019</span>
                  <span className="ceu-footer-page">Page 1 of 2</span>
                </footer>
              </div>
            )}

            {/* ================= PAGE 2 ================= */}
            {(activePage === "page2" || activePage === "all") && (
              <div className="ceu-paper-sheet ceu-paper-sheet--page2" style={{ marginTop: activePage === "all" ? "32px" : "0" }}>
                {/* Page 2 Header */}
                <header className="ceu-page2-mini-header">
                  <div className="ceu-page2-header-title">
                    <span>CENTRO ESCOLAR UNIVERSITY • SCHOOL OF DENTISTRY</span>
                    <strong>ORAL DIAGNOSIS FORM — CLINICAL FINDINGS & CONSENT</strong>
                  </div>
                  <div className="ceu-page2-header-id">
                    <span>Patient: <strong>{form.name || "Patient Record"}</strong></span>
                    <span>ID: <strong>#{form.eightDigitId}</strong></span>
                  </div>
                </header>

                {/* D. DIAGNOSTIC TEST TABLE */}
                <section className="ceu-section">
                  <div className="ceu-section-header ceu-section-header--between">
                    <h4>D. DIAGNOSTIC TEST</h4>
                    <button
                      type="button"
                      className="ceu-table-add-btn"
                      onClick={handleAddDiagnosticRow}
                    >
                      + Add Tooth Test Row
                    </button>
                  </div>

                  <div className="ceu-table-responsive">
                    <table className="ceu-bordered-table">
                      <thead>
                        <tr>
                          <th>Tooth No.</th>
                          <th>Mobility</th>
                          <th>Palpation</th>
                          <th>Percussion</th>
                          <th>Test Cavity</th>
                          <th>Hot Test</th>
                          <th>Cold Test</th>
                          <th>Anesthetic</th>
                          <th>Electric Pulp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {form.diagnosticTests.map((row, rIdx) => (
                          <tr key={`diag-${rIdx}`}>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.toothNo}
                                onChange={(e) => updateDiagnosticRow(rIdx, "toothNo", e.target.value)}
                                placeholder="#19"
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.mobility}
                                onChange={(e) => updateDiagnosticRow(rIdx, "mobility", e.target.value)}
                                placeholder="0"
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.palapation || row.palpation}
                                onChange={(e) => updateDiagnosticRow(rIdx, "palpation", e.target.value)}
                                placeholder="Neg"
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.percussion}
                                onChange={(e) => updateDiagnosticRow(rIdx, "percussion", e.target.value)}
                                placeholder="Mild"
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.cavity}
                                onChange={(e) => updateDiagnosticRow(rIdx, "cavity", e.target.value)}
                                placeholder="Class II"
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.hotTest}
                                onChange={(e) => updateDiagnosticRow(rIdx, "hotTest", e.target.value)}
                                placeholder="WNL"
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.coldTest}
                                onChange={(e) => updateDiagnosticRow(rIdx, "coldTest", e.target.value)}
                                placeholder="Delayed"
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.anesthetic}
                                onChange={(e) => updateDiagnosticRow(rIdx, "anesthetic", e.target.value)}
                                placeholder="Pos"
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.electricPulp}
                                onChange={(e) => updateDiagnosticRow(rIdx, "electricPulp", e.target.value)}
                                placeholder="Normal"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Radiographic Interpretation */}
                <section className="ceu-section">
                  <div className="ceu-subheading ceu-subheading--with-action">
                    <strong>Radiographic Interpretation:</strong>
                    <button
                      type="button"
                      className={`ceu-mic-btn ${isDictatingField === "radiographicInterpretation" ? "listening" : ""}`}
                      onClick={() => toggleDictation("radiographicInterpretation")}
                      title="Dictate with voice"
                    >
                      🎙️ {isDictatingField === "radiographicInterpretation" ? "Listening..." : "Dictate"}
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    className="ceu-ruled-textarea"
                    value={form.radiographicInterpretation}
                    onChange={(e) => updateField("radiographicInterpretation", e.target.value)}
                    placeholder="Bitewing / periapical findings, bone levels, apical radiolucency..."
                  />
                </section>

                {/* Tentative Diagnosis & Recommended Treatment Plan Side-by-Side */}
                <section className="ceu-section">
                  <div className="ceu-diagnosis-plan-grid">
                    <div className="ceu-col-plan">
                      <div className="ceu-subheading">
                        <strong>Tentative Diagnosis:</strong>
                      </div>
                      <div className="ceu-ruled-lines-group">
                        {form.tentativeDiagnosis.map((item, idx) => (
                          <div className="ceu-ruled-line-item" key={`diag-${idx}`}>
                            <span className="ceu-line-num">{idx + 1}.</span>
                            <input
                              type="text"
                              className="ceu-ruled-input"
                              value={item}
                              onChange={(e) => updateDiagnosis(idx, e.target.value)}
                              placeholder={idx === 0 ? "e.g. Dental Caries Tooth #19" : ""}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="ceu-col-plan">
                      <div className="ceu-subheading">
                        <strong>Recommended Treatment Plan:</strong>
                      </div>
                      <div className="ceu-ruled-lines-group">
                        {form.recommendedTreatmentPlan.map((item, idx) => (
                          <div className="ceu-ruled-line-item" key={`treat-${idx}`}>
                            <span className="ceu-line-num">{idx + 1}.</span>
                            <input
                              type="text"
                              className="ceu-ruled-input"
                              value={item}
                              onChange={(e) => updateTreatmentPlan(idx, e.target.value)}
                              placeholder={idx === 0 ? "e.g. Posterior Composite Restoration #19" : ""}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="ceu-form-row ceu-form-row--signatures">
                    <div className="ceu-field ceu-field--grow">
                      <span className="ceu-label">Examined by:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.examinedBy}
                        onChange={(e) => updateField("examinedBy", e.target.value)}
                      />
                    </div>
                    <div className="ceu-field ceu-field--sm">
                      <span className="ceu-label">Date:</span>
                      <input
                        type="date"
                        className="ceu-line-input"
                        value={form.examDate}
                        onChange={(e) => updateField("examDate", e.target.value)}
                      />
                    </div>
                    <div className="ceu-field ceu-field--sm">
                      <span className="ceu-label">Clinic Level:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.clinicLevel}
                        onChange={(e) => updateField("clinicLevel", e.target.value)}
                        placeholder="Clinical Dentistry II"
                      />
                    </div>
                  </div>
                </section>

                {/* Treatment Approval Log Grid & CI's Remarks */}
                <section className="ceu-section">
                  <div className="ceu-treatment-log-split">
                    <div className="ceu-log-half">
                      <table className="ceu-bordered-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Cases / Approved</th>
                            <th>Tooth No.</th>
                            <th>O.D. C.I.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {form.treatmentLog.map((log, lIdx) => (
                            <tr key={`log-${lIdx}`}>
                              <td>{log.date}</td>
                              <td>{log.casesApproved}</td>
                              <td>{log.toothNo}</td>
                              <td>{log.ciSign}</td>
                            </tr>
                          ))}
                          <tr>
                            <td style={{ height: "26px" }}></td>
                            <td></td>
                            <td></td>
                            <td></td>
                          </tr>
                          <tr>
                            <td style={{ height: "26px" }}></td>
                            <td></td>
                            <td></td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="ceu-remarks-half">
                      <div className="ceu-subheading">
                        <strong>CI's Remarks:</strong>
                      </div>
                      <textarea
                        rows={4}
                        className="ceu-ruled-textarea"
                        value={form.ciRemarks}
                        onChange={(e) => updateField("ciRemarks", e.target.value)}
                        placeholder="Clinical Instructor evaluations, rubric notes and clearance..."
                      />
                    </div>
                  </div>
                </section>

                {/* DATA PRIVACY ACT STATEMENT POLICY */}
                <section className="ceu-section ceu-section--privacy">
                  <div className="ceu-privacy-statement-box">
                    <h5>DATA PRIVACY ACT STATEMENT POLICY</h5>
                    <p>
                      Centro Escolar University recognizes its responsibilities under Republic Act No. 10173 (Act),
                      also known as the <em>Data Privacy Act of 2012</em>, with respect to the personal and sensitive
                      personal information you provide, and is committed to ensuring the confidentiality and security
                      of such information. The data collected herein will be used strictly for clinical teaching,
                      diagnosis, treatment planning, and dental healthcare records within CEU School of Dentistry.
                    </p>
                  </div>
                </section>

                {/* DENTAL PROCEDURE CONSENT FORM BLOCK */}
                <section className="ceu-section ceu-section--consent">
                  <div className="ceu-section-header ceu-section-header--between">
                    <h4>DENTAL PROCEDURE CONSENT FORM</h4>
                    <div className="ceu-view-switch">
                      {form.consentCropUrl && (
                        <button
                          type="button"
                          className={`ceu-switch-btn ${consentView !== "form" ? "active" : ""}`}
                          onClick={() => setConsentView("crop")}
                        >
                          📷 Cropped Physical Consent Scan
                        </button>
                      )}
                      <button
                        type="button"
                        className={`ceu-switch-btn ${consentView === "form" || !form.consentCropUrl ? "active" : ""}`}
                        onClick={() => setConsentView("form")}
                      >
                        ✍️ Interactive Consent Box
                      </button>
                    </div>
                  </div>

                  {/* If Consent Block is cropped from Page 2 scan, show it directly */}
                  {form.consentCropUrl && consentView !== "form" ? (
                    <div className="ceu-cropped-consent-container">
                      <div className="ceu-cropped-banner">
                        <span>✓ Signed Physical Consent Form Cropped from Page 2 Scan</span>
                        <div className="ceu-cropped-actions">
                          <button
                            type="button"
                            className="ceu-preview-zoom-btn"
                            onClick={() => setExpandedImage(form.consentCropUrl)}
                          >
                            🔍 Zoom & Inspect
                          </button>
                          <button
                            type="button"
                            className="ceu-recrop-btn"
                            onClick={() => fileInputPage2Ref.current?.click()}
                          >
                            🔄 Re-upload / Crop
                          </button>
                        </div>
                      </div>
                      <div className="ceu-cropped-image-wrapper">
                        <img
                          src={form.consentCropUrl}
                          alt="Cropped CEU Signed Dental Consent Form"
                          className="ceu-cropped-consent-img"
                        />
                      </div>
                    </div>
                  ) : (
                    /* Interactive Consent Body */
                    <div className="ceu-consent-legal-box">
                      <p className="ceu-consent-paragraph">
                        I,{" "}
                        <input
                          type="text"
                          className="ceu-inline-line"
                          value={form.consentPatientName || form.name}
                          onChange={(e) => updateField("consentPatientName", e.target.value)}
                          placeholder="Full Patient Legal Name"
                        />
                        , of legal age, residing at{" "}
                        <input
                          type="text"
                          className="ceu-inline-line ceu-inline-line--wide"
                          value={form.homeAddress}
                          onChange={(e) => updateField("homeAddress", e.target.value)}
                          placeholder="Home Address"
                        />
                        , hereby authorize and consent to the dental examination and necessary diagnostic procedures,
                        administration of local anesthesia, dental prophylaxis, restorative procedures, and other
                        treatments as deemed necessary by the student clinicians under the supervision of the faculty
                        of the CEU School of Dentistry.
                      </p>

                      <div className="ceu-minor-consent-box">
                        <div className="ceu-minor-title">For Minor Patient:</div>
                        <p>
                          I,{" "}
                          <input
                            type="text"
                            className="ceu-inline-line"
                            value={form.consentGuardianName}
                            onChange={(e) => updateField("consentGuardianName", e.target.value)}
                            placeholder="Parent / Legal Guardian Name"
                          />
                          , the parent/legal guardian of{" "}
                          <span className="ceu-minor-target-name">{form.name || "[Patient Name]"}</span>, hereby give my
                          full consent for the dental procedures stated above.
                        </p>
                      </div>

                      <div className="ceu-consent-signatures-grid">
                        <div className="ceu-sig-block">
                          <div className="ceu-sig-line">
                            <span className="ceu-sig-text-printed">{form.name || "Patient / Guardian"}</span>
                          </div>
                          <span className="ceu-sig-caption">Signature over Printed Name of Patient / Parent / Legal Guardian</span>
                          <div className="ceu-field ceu-field--sig-date">
                            <span className="ceu-label">Date:</span>
                            <input
                              type="date"
                              className="ceu-line-input"
                              value={form.consentDate}
                              onChange={(e) => updateField("consentDate", e.target.value)}
                            />
                          </div>
                        </div>

                        <div className="ceu-sig-block">
                          <div className="ceu-sig-line">
                            <span className="ceu-sig-text-printed">{form.consentClinicianName || "Dr. Jane Doe / Student Clinician"}</span>
                          </div>
                          <span className="ceu-sig-caption">Signature over Printed Name of Clinician</span>
                          <div className="ceu-field ceu-field--sig-date">
                            <span className="ceu-label">Date:</span>
                            <input
                              type="date"
                              className="ceu-line-input"
                              value={form.consentDate}
                              onChange={(e) => updateField("consentDate", e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                {/* Page 2 Official Footer */}
                <footer className="ceu-official-footer">
                  <span>Copy to student</span>
                  <span className="ceu-footer-code">AAF-DE-005</span>
                  <span>09/09/2019</span>
                  <span className="ceu-footer-page">Page 2 of 2</span>
                </footer>
              </div>
            )}

            {/* Bottom Actions */}
            <div className="ceu-odf-bottom-bar">
              <button type="button" className="ceu-btn-secondary" onClick={onCancel}>
                Cancel & Close
              </button>
              <div className="ceu-bottom-right-actions">
                <button
                  type="button"
                  className="ceu-btn-print"
                  onClick={() => window.print()}
                  title="Print official CEU Oral Diagnosis Form"
                >
                  🖨️ Print Form
                </button>
                <button type="submit" className="ceu-btn-primary">
                  💾 Submit Oral Diagnosis Form
                </button>
              </div>
            </div>

          </form>
        </div>
      </div>

      {/* Expanded Image Zoom Modal */}
      {expandedImage && (
        <div className="ceu-zoom-overlay" onClick={() => setExpandedImage(null)}>
          <div className="ceu-zoom-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="ceu-zoom-header">
              <strong>Region of Interest (ROI) High-Resolution Inspection</strong>
              <button
                type="button"
                className="ceu-zoom-close"
                onClick={() => setExpandedImage(null)}
              >
                ✕ Close
              </button>
            </div>
            <div className="ceu-zoom-body">
              <img src={expandedImage} alt="Cropped ROI Inspection" className="ceu-zoom-img" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
