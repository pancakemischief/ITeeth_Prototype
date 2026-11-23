import { useState, useRef, useEffect } from "react";
import { cropImageRegion, ODF_CROP_PRESETS } from "../lib/cropUtils";
import {
  to8DigitId,
  uploadOdfImageToStorage,
  resolveOdfScanSignedUrl,
  findExistingPatientByName,
  generateNextPatientId,
  getLocalPatients,
  getLocalPending,
  getTodayManilaIso,
  getTodayManilaDisplay,
  computeCanonicalRecordHash,
  DECLINE_RUBRIC_DOMAINS,
  OCR_CONFIDENCE_LOW,
  OCR_CONFIDENCE_WARN,
  summarizeOcrConfidence,
} from "../lib/dentalService";
import {
  analyzeOdfWithAzure,
  analyzeOdfWithPaddle,
  parseAzurePage1ToForm,
  parseAzurePage2ToForm,
} from "../lib/azureOdfParser";
import { useWhisperDictation } from "../lib/whisperClient";
import { isStudentClinician } from "../lib/roleUtils";
import MedicalAlertBanner from "./MedicalBannerAlert";
import "./OralDiagnosisForm.css";

function formatSignatureTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

const OCR_FIELD_LABELS = {
  name: "Patient Name",
  birthDate: "Birthdate",
  age: "Age",
  sex: "Sex",
  homeAddress: "Home Address",
  cellPhone: "Cell Phone No.",
  bloodPressure: "Blood Pressure",
  pulseRate: "Pulse Rate",
  allergySpecify: "Allergy (Specify)",
  chiefComplaints: "Chief Complaints",
  historyOfPresentIllness: "History of Present Illness",
  tentativeDiagnosis: "Tentative Diagnosis",
  recommendedTreatmentPlan: "Recommended Treatment Plan",
  teethFindings: "Odontogram Findings",
};

const OCR_KEY_ALIASES = {
  name: ["PatientName", "Name", "FullName"],
  birthDate: ["BirthDate", "Birthdate", "DateOfBirth", "DOB"],
  age: ["Age"],
  sex: ["Sex", "Gender"],
  homeAddress: ["HomeAddress", "Address"],
  cellPhone: ["CellPhone", "CellphoneNo", "CellNo", "Mobile", "MobileNo"],
  bloodPressure: ["BloodPressure", "BP"],
  pulseRate: ["PulseRate", "Pulse", "PR"],
  allergySpecify: ["AllergySpecify", "Allergy", "Allergies"],
  chiefComplaints: [
    "ChiefComplaint",
    "ChiefComplaints",
    "ChiefComplaint1",
    "ChiefComplaint2",
    "ChiefComplaint3",
    "ChiefComplaint4",
    "Complaint1",
    "Complaint2",
    "Complaint3",
    "Complaint4",
  ],
  historyOfPresentIllness: [
    "HistoryOfPresentIllness",
    "PresentIllness",
    "BHistoryOfPresentIllness",
  ],
  tentativeDiagnosis: [
    "TentativeDiagnosis1",
    "TentativeDiagnosis2",
    "TentativeDiagnosis3",
    "TentativeDiagnosis4",
    "TentativeDiagnosis5",
    "TentativeDiagnosis6",
    "Diagnosis1",
    "Diagnosis2",
    "Diagnosis3",
    "Diagnosis4",
  ],
  recommendedTreatmentPlan: [
    "RecommendedTreatmentPlan1",
    "RecommendedTreatmentPlan2",
    "RecommendedTreatmentPlan3",
    "RecommendedTreatmentPlan4",
    "RecommendedTreatmentPlan5",
    "RecommendedTreatmentPlan6",
    "TreatmentPlan1",
    "TreatmentPlan2",
    "Plan1",
    "Plan2",
  ],
  teethFindings: ["Odontogram", "MouthExamination", "TeethFindings"],
};

function normalizeOcrKeyToken(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeConfidenceScore(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const num = Number(raw);
  if (Number.isNaN(num)) return null;
  const normalized = num > 1 && num <= 100 ? num / 100 : num;
  return Math.round(Math.max(0.05, Math.min(0.99, normalized)) * 100) / 100;
}

function findBackendConfidenceForField(ocrResult, fieldKey) {
  const aliases = (OCR_KEY_ALIASES[fieldKey] || [fieldKey]).map(normalizeOcrKeyToken);
  const scores = [];

  const fieldsMap = ocrResult?.fields;
  if (fieldsMap && typeof fieldsMap === "object") {
    for (const [k, fieldObj] of Object.entries(fieldsMap)) {
      const normK = normalizeOcrKeyToken(k);
      if (aliases.includes(normK)) {
        const s = normalizeConfidenceScore(fieldObj?.confidence);
        if (s !== null) scores.push(s);
      }
    }
  }

  const kvList = Array.isArray(ocrResult?.keyValuePairs) ? ocrResult.keyValuePairs : [];
  for (const kv of kvList) {
    const normKv = normalizeOcrKeyToken(kv?.key);
    if (!normKv) continue;
    if (aliases.some((cand) => normKv === cand || normKv.endsWith(cand) || normKv.startsWith(cand))) {
      const s = normalizeConfidenceScore(kv?.confidence);
      if (s !== null) scores.push(s);
    }
  }

  if (scores.length === 0) return null;
  return Math.min(...scores);
}

function computeHeuristicConfidence(fieldKey, extractedVal, engine) {
  const rawText = Array.isArray(extractedVal)
    ? extractedVal.map((v) => String(v || "").trim()).filter(Boolean).join(" ")
    : typeof extractedVal === "object" && extractedVal !== null
    ? Object.values(extractedVal).map((v) => String(v || "").trim()).filter(Boolean).join(" ")
    : String(extractedVal || "").trim();

  if (!rawText) return null;

  if (fieldKey === "sex" && /^(male|female)$/i.test(rawText)) {
    return engine === "azure-idp" ? 0.91 : 0.86;
  }

  let score = engine === "paddleocr" ? 0.80 : 0.83;

  // Ambiguous OCR artifacts / unrecognizable symbols
  if (/[~^|\\_{}<>?]/.test(rawText)) {
    score -= 0.16;
  }

  // Numeric/vital/date ambiguity checks
  if (fieldKey === "birthDate") {
    if (!/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(rawText) && !/^\d{4}-\d{2}-\d{2}$/.test(rawText)) {
      score -= 0.15;
    }
  } else if (fieldKey === "age") {
    const num = Number(rawText);
    if (!/^\d{1,3}$/.test(rawText) || Number.isNaN(num) || num < 1 || num > 115) {
      score -= 0.18;
    }
  } else if (fieldKey === "bloodPressure") {
    if (!/^\d{2,3}\/\d{2,3}$/.test(rawText.replace(/\s+/g, ""))) {
      score -= 0.16;
    }
  } else if (fieldKey === "pulseRate") {
    const cleaned = rawText.replace(/\s*bpm$/i, "").trim();
    if (!/^\d{2,3}$/.test(cleaned)) {
      score -= 0.14;
    }
  } else if (fieldKey === "cellPhone") {
    const digits = rawText.replace(/\D/g, "");
    if (digits.length < 7 || /[OIlS]/.test(rawText.replace(/[+\-()\s]/g, ""))) {
      score -= 0.15;
    }
  } else if (rawText.length <= 2) {
    score -= 0.14;
  }

  // High noise / punctuation density check
  const nonAlphaNum = (rawText.match(/[^a-zA-Z0-9\s.,/-]/g) || []).length;
  if (rawText.length > 0 && nonAlphaNum / rawText.length > 0.25) {
    score -= 0.10;
  }

  return Math.round(Math.max(0.42, Math.min(0.95, score)) * 100) / 100;
}

function extractOcrConfidenceMap(ocrResult, extractedUpdates, engine) {
  const confidenceMap = {};
  const targetFields = Object.keys(OCR_FIELD_LABELS);

  for (const fieldKey of targetFields) {
    if (!(fieldKey in extractedUpdates)) continue;
    const val = extractedUpdates[fieldKey];
    const hasValue = Array.isArray(val)
      ? val.some((item) => String(item || "").trim().length > 0)
      : typeof val === "object" && val !== null
      ? Object.keys(val).length > 0
      : String(val || "").trim().length > 0;
    if (!hasValue) continue;

    const backendScore = findBackendConfidenceForField(ocrResult, fieldKey);
    if (backendScore !== null) {
      confidenceMap[fieldKey] = backendScore;
    } else {
      const heuristic = computeHeuristicConfidence(fieldKey, val, engine);
      if (heuristic !== null) {
        confidenceMap[fieldKey] = heuristic;
      }
    }
  }

  return confidenceMap;
}

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
  { toothNo: "", mobility: "", palpation: "", percussion: "", cavity: "", hotTest: "", coldTest: "", anesthetic: "", electricPulp: "" },
  { toothNo: "", mobility: "", palpation: "", percussion: "", cavity: "", hotTest: "", coldTest: "", anesthetic: "", electricPulp: "" },
];

export default function OralDiagnosisForm({
  patientId,
  initialData = null,
  patients = null,
  pending = null,
  readOnly = false,
  isSubmissionView = false,
  onViewUploadedScans = null,
  revisionFeedback = null,
  onSave = () => {},
  onCancel = () => {},
  currentUser,
}) {
  const isStudent = isStudentClinician(currentUser?.role);
  const hideFull2PageBtn = isSubmissionView && isStudent;
  const activeRevisionFeedback = revisionFeedback || initialData?.reviewFeedback || null;

  const [activePage, setActivePage] = useState(
    hideFull2PageBtn ? "page1" : readOnly ? "all" : "page1"
  ); // "page1" | "page2" | "all" | "uploaded"
  const [uploadedPageFilter, setUploadedPageFilter] = useState("both"); // "both" | "page1" | "page2"
  const [odontogramView, setOdontogramView] = useState("auto"); // "crop" | "grid" | "auto"
  const [consentView, setConsentView] = useState("auto"); // "crop" | "form" | "auto"
  const [isProcessingOcr, setIsProcessingOcr] = useState(false);
  const [ocrProgressText, setOcrProgressText] = useState("");
  const [expandedImage, setExpandedImage] = useState(null);

  const fileInputPage1Ref = useRef(null);
  const fileInputPage2Ref = useRef(null);

  const knownPatients = patients && patients.length > 0 ? patients : getLocalPatients();
  const knownPending = pending && pending.length > 0 ? pending : getLocalPending();
  const isPreboundPatient = Boolean(initialData?.eightDigitId && initialData?.name);
  const [defaultNewId] = useState(() =>
    patientId || initialData?.eightDigitId || initialData?.id
      ? to8DigitId(patientId || initialData?.eightDigitId || initialData?.id)
      : generateNextPatientId(knownPatients, knownPending)
  );
  const [matchedPatientInfo, setMatchedPatientInfo] = useState(() =>
    initialData?.name ? findExistingPatientByName(initialData.name, knownPatients) : null
  );

  // Form State initialized to CEU ODF layout
  const [form, setForm] = useState(() => {
    const rawId = defaultNewId;
    return {
      // Demographics
      eightDigitId: rawId,
      name: initialData?.name || "",
      date: initialData?.visitDate || getTodayManilaIso(),
      homeAddress: initialData?.homeAddress || "",
      birthDate: initialData?.birthDate || initialData?.dateOfBirth || "",
      age: initialData?.age || "",
      sex: initialData?.sex || initialData?.gender || "",
      height: initialData?.height || "",
      weight: initialData?.weight || "",
      civilStatus: initialData?.civilStatus || "",
      homeTel: initialData?.homeTel || "",
      cellPhone: initialData?.cellPhone || initialData?.phone || "",
      nationality: initialData?.nationality || "Filipino",
      occupation: initialData?.occupation || "",
      religion: initialData?.religion || "",

      // Case History
      chiefComplaints: initialData?.chiefComplaints?.length === 4
        ? initialData.chiefComplaints
        : Array.isArray(initialData?.chiefComplaints)
        ? [
            initialData.chiefComplaints[0] || "",
            initialData.chiefComplaints[1] || "",
            initialData.chiefComplaints[2] || "",
            initialData.chiefComplaints[3] || "",
          ]
        : [
            initialData?.procedure || "",
            "",
            "",
            "",
          ],
      historyOfPresentIllness: initialData?.historyOfPresentIllness || initialData?.notes || "",

      // Past History: key-value map for conditions: "present" (/), "none" (X), or ""
      pastHistory: initialData?.pastHistory || {},
      allergyCheck: initialData?.allergyCheck || "",
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
      dentureUpperCheck: initialData?.dentureUpperCheck || false,
      dentureUpperNone: initialData?.dentureUpperNone || false,
      dentureUpperType: initialData?.dentureUpperType || initialData?.dentureUpper || "",
      dentureUpperSince: initialData?.dentureUpperSince || "",
      dentureLowerCheck: initialData?.dentureLowerCheck || false,
      dentureLowerNone: initialData?.dentureLowerNone || false,
      dentureLowerType: initialData?.dentureLowerType || initialData?.dentureLower || "",
      dentureLowerSince: initialData?.dentureLowerSince || "",

      // Clinical Exam - Extraoral (Free text with blanks: ___ Normal ___ Abnormal, specify ___)
      head: initialData?.head || "",
      headNormal: initialData?.headNormal !== undefined ? initialData.headNormal : (initialData?.head === "Normal" ? "/" : ""),
      headAbnormalSpecify: initialData?.headAbnormalSpecify || initialData?.headSpecify || (initialData?.head === "Abnormal" ? "Abnormal" : ""),
      tmj: initialData?.tmj || "",
      tmjNormal: initialData?.tmjNormal !== undefined ? initialData.tmjNormal : (initialData?.tmj === "Normal" ? "/" : ""),
      tmjAbnormalSpecify: initialData?.tmjAbnormalSpecify || initialData?.tmjSpecify || (initialData?.tmj === "Abnormal" ? "Abnormal" : ""),
      eyes: initialData?.eyes || "",
      eyesNormal: initialData?.eyesNormal !== undefined ? initialData.eyesNormal : (initialData?.eyes === "Normal" ? "/" : ""),
      eyesAbnormalSpecify: initialData?.eyesAbnormalSpecify || initialData?.eyesSpecify || (initialData?.eyes === "Abnormal" ? "Abnormal" : ""),

      // Vital Signs
      bloodPressure: initialData?.bloodPressure || "",
      pulseRate: initialData?.pulseRate || "",
      respiratoryRate: initialData?.respiratoryRate || "",
      temperature: initialData?.temperature || "",

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
      teethFindings: initialData?.teethFindings || {},

      // Page 2: Diagnostic Tests
      diagnosticTests: initialData?.diagnosticTests || INITIAL_DIAGNOSTIC_TESTS,
      radiographicInterpretation: initialData?.radiographicInterpretation || "",
      tentativeDiagnosis: initialData?.tentativeDiagnosis?.length === 6
        ? initialData.tentativeDiagnosis
        : [
            initialData?.tentativeDiagnosis?.[0] || "",
            initialData?.tentativeDiagnosis?.[1] || "",
            initialData?.tentativeDiagnosis?.[2] || "",
            initialData?.tentativeDiagnosis?.[3] || "",
            initialData?.tentativeDiagnosis?.[4] || "",
            initialData?.tentativeDiagnosis?.[5] || "",
          ],
      recommendedTreatmentPlan: initialData?.recommendedTreatmentPlan?.length === 6
        ? initialData.recommendedTreatmentPlan
        : [
            initialData?.recommendedTreatmentPlan?.[0] || "",
            initialData?.recommendedTreatmentPlan?.[1] || "",
            initialData?.recommendedTreatmentPlan?.[2] || "",
            initialData?.recommendedTreatmentPlan?.[3] || "",
            initialData?.recommendedTreatmentPlan?.[4] || "",
            initialData?.recommendedTreatmentPlan?.[5] || "",
          ],
      examinedBy: initialData?.examinedBy || "",
      examDate: initialData?.examDate || "",
      clinicLevel: initialData?.clinicLevel || "",

      // 9 columns x 10 rows Treatment Approval Log
      treatmentLogRows: initialData?.treatmentLogRows && initialData.treatmentLogRows.length === 10
        ? initialData.treatmentLogRows
        : Array.from({ length: 10 }, (_, i) => {
            const left = initialData?.treatmentLog?.[i] || {};
            const right = initialData?.treatmentLog?.[i + 10] || {};
            return {
              leftDate: left.date || "",
              leftCasesApproved: left.casesApproved || "",
              leftToothNo: left.toothNo || "",
              leftCi: left.ciSign || "",
              rightDate: right.date || "",
              rightCasesApproved: right.casesApproved || "",
              rightToothNo: right.toothNo || "",
              rightCi: right.ciSign || "",
            };
          }),
      treatmentLog: initialData?.treatmentLog || [],
      ciRemarks: initialData?.ciRemarks || "",

      // Section D / Consent Block
      rawScanPage2Url: initialData?.rawScanPage2Url || null,
      consentCropUrl: initialData?.consentCropUrl || null,
      consentPatientName: initialData?.consentPatientName || "",
      consentHomeAddress: initialData?.consentHomeAddress || "",
      consentDate: initialData?.consentDate || "",
      consentGuardianName: initialData?.consentGuardianName || "",
      consentMinorPatientName: initialData?.consentMinorPatientName || "",
      consentClinicianName: initialData?.consentClinicianName || "",
      consentClinicianDate: initialData?.consentClinicianDate || "",
      clinician:
        initialData?.clinician ||
        (currentUser?.name
          ? `${currentUser.name} (${currentUser.role})`
          : currentUser?.email || ""),
      approvalSignature: initialData?.approvalSignature || null,

      // OCR Confidence & Clinician Verification Telemetry
      ocrConfidence:
        initialData?.ocrConfidence && typeof initialData.ocrConfidence === "object"
          ? { ...initialData.ocrConfidence }
          : {},
      ocrEngine: initialData?.ocrEngine || null,
      ocrVerifiedFields:
        initialData?.ocrVerifiedFields && typeof initialData.ocrVerifiedFields === "object"
          ? { ...initialData.ocrVerifiedFields }
          : {},
    };
  });

  const [dictationTelemetry, setDictationTelemetry] = useState(() => {
    const existing = initialData?.dictationTelemetry;
    if (existing && typeof existing === "object") {
      return {
        engine: existing.engine || "whisper.cpp",
        dictatedFields: Array.isArray(existing.dictatedFields) ? [...existing.dictatedFields] : [],
        totalInferenceMs: Number(existing.totalInferenceMs || 0),
        lastModelId: existing.lastModelId || null,
      };
    }
    return {
      engine: "whisper.cpp",
      dictatedFields: [],
      totalInferenceMs: 0,
      lastModelId: null,
    };
  });

  const [signatureCheck, setSignatureCheck] = useState({
    expectedHash: "",
    status: null, // "verified" | "tampered"
  });

  const expectedSignatureHash = form.approvalSignature?.recordHash || "";

  useEffect(() => {
    if (!form.approvalSignature) return;
    let active = true;

    computeCanonicalRecordHash(form).then((computedHash) => {
      if (!active) return;
      const isMatch = Boolean(expectedSignatureHash && computedHash === expectedSignatureHash);
      setSignatureCheck({
        expectedHash: expectedSignatureHash,
        status: isMatch ? "verified" : "tampered",
      });
    });

    return () => {
      active = false;
    };
  }, [form, expectedSignatureHash]);

  const signatureStatus = form.approvalSignature ? signatureCheck.status : null;

  const hasAnyScan = Boolean(
    form.rawScanUrl ||
      form.rawScanPage2Url ||
      form.odontogramCropUrl ||
      form.consentCropUrl
  );
  const scanKey = JSON.stringify([
    form.rawScanUrl || null,
    form.rawScanPage2Url || null,
    form.odontogramCropUrl || null,
    form.consentCropUrl || null,
  ]);
  const [resolvedScansState, setResolvedScansState] = useState({
    key: "",
    rawScanUrl: null,
    rawScanPage2Url: null,
    odontogramCropUrl: null,
    consentCropUrl: null,
  });

  useEffect(() => {
    if (!hasAnyScan) return;
    let active = true;

    Promise.all([
      resolveOdfScanSignedUrl(form.rawScanUrl),
      resolveOdfScanSignedUrl(form.rawScanPage2Url),
      resolveOdfScanSignedUrl(form.odontogramCropUrl),
      resolveOdfScanSignedUrl(form.consentCropUrl),
    ]).then(([rawScanUrl, rawScanPage2Url, odontogramCropUrl, consentCropUrl]) => {
      if (!active) return;
      setResolvedScansState({
        key: scanKey,
        rawScanUrl,
        rawScanPage2Url,
        odontogramCropUrl,
        consentCropUrl,
      });
    });

    return () => {
      active = false;
    };
  }, [
    hasAnyScan,
    scanKey,
    form.rawScanUrl,
    form.rawScanPage2Url,
    form.odontogramCropUrl,
    form.consentCropUrl,
  ]);

  const isLoadingScans = Boolean(hasAnyScan && resolvedScansState.key !== scanKey);
  const resolvedScans =
    hasAnyScan && resolvedScansState.key === scanKey
      ? resolvedScansState
      : {
          rawScanUrl: null,
          rawScanPage2Url: null,
          odontogramCropUrl: null,
          consentCropUrl: null,
        };

  const resolvePatientIdForName = (nameValue, currentId) => {
    const matched = findExistingPatientByName(nameValue, knownPatients);
    if (matched) {
      setMatchedPatientInfo(matched);
      return to8DigitId(matched.id || matched.eightDigitId);
    }
    setMatchedPatientInfo(null);
    return isPreboundPatient ? currentId : defaultNewId;
  };

  const getFieldOcrMeta = (fieldKey) => {
    const raw = form.ocrConfidence?.[fieldKey];
    if (raw === undefined || raw === null || raw === "") return null;
    const score = Number(raw);
    if (Number.isNaN(score)) return null;
    const severity =
      score < OCR_CONFIDENCE_LOW
        ? "low"
        : score < OCR_CONFIDENCE_WARN
        ? "warn"
        : "high";
    const isVerified = Boolean(form.ocrVerifiedFields?.[fieldKey]);
    return { score, severity, isVerified };
  };

  const markFieldOcrVerified = (fieldKey) => {
    if (readOnly) return;
    setForm((prev) => ({
      ...prev,
      ocrVerifiedFields: {
        ...(prev.ocrVerifiedFields || {}),
        [fieldKey]: true,
      },
    }));
  };

  const getOcrInputStyle = (fieldKey, baseStyle = {}) => {
    const meta = getFieldOcrMeta(fieldKey);
    if (!meta || meta.score >= OCR_CONFIDENCE_WARN || meta.isVerified) {
      return baseStyle;
    }
    const tint = meta.severity === "low" ? "#dc2626" : "#f59e0b";
    const bg = meta.severity === "low" ? "#fef2f2" : "#fffbeb";
    return {
      ...baseStyle,
      borderColor: tint,
      backgroundColor: bg,
    };
  };

  const renderOcrBadge = (fieldKey) => {
    const meta = getFieldOcrMeta(fieldKey);
    if (!meta || meta.score >= OCR_CONFIDENCE_WARN) return null;
    const pct = Math.round(meta.score * 100);
    if (meta.isVerified) {
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "10.5px",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            padding: "1px 7px",
            borderRadius: "999px",
            background: "#ecfdf5",
            color: "#047857",
            border: "1px solid #a7f3d0",
            whiteSpace: "nowrap",
          }}
        >
          ✓ Verified ({pct}%)
        </span>
      );
    }
    const isLow = meta.severity === "low";
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          fontSize: "10.5px",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          padding: "1px 7px",
          borderRadius: "999px",
          background: isLow ? "#fef2f2" : "#fffbeb",
          color: isLow ? "#b91c1c" : "#b45309",
          border: `1px solid ${isLow ? "#fecaca" : "#fcd34d"}`,
          whiteSpace: "nowrap",
        }}
      >
        <span>{isLow ? `Low OCR • ${pct}%` : `Verify OCR • ${pct}%`}</span>
        {!readOnly && (
          <button
            type="button"
            onClick={() => markFieldOcrVerified(fieldKey)}
            style={{
              border: "none",
              background: isLow ? "#dc2626" : "#d97706",
              color: "#ffffff",
              borderRadius: "999px",
              padding: "1px 6px",
              fontSize: "10px",
              fontWeight: 800,
              cursor: "pointer",
              fontFamily: "inherit",
              lineHeight: 1.3,
            }}
          >
            Verify
          </button>
        )}
      </span>
    );
  };

  const updateField = (field, value) => {
    if (readOnly) return;
    setForm((prev) => {
      const hasOcrScore = prev.ocrConfidence?.[field] !== undefined;
      const nextVerified = hasOcrScore
        ? { ...(prev.ocrVerifiedFields || {}), [field]: true }
        : prev.ocrVerifiedFields;
      if (field === "name") {
        return {
          ...prev,
          name: value,
          eightDigitId: resolvePatientIdForName(value, prev.eightDigitId),
          ocrVerifiedFields: nextVerified,
        };
      }
      return { ...prev, [field]: value, ocrVerifiedFields: nextVerified };
    });
  };

  const updateTreatmentLogRow = (rowIndex, field, value) => {
    if (readOnly) return;
    setForm((prev) => {
      const rows = [...prev.treatmentLogRows];
      rows[rowIndex] = { ...rows[rowIndex], [field]: value };

      const flatLog = [];
      rows.forEach((r) => {
        if (r.leftDate || r.leftCasesApproved || r.leftToothNo || r.leftCi) {
          flatLog.push({
            date: r.leftDate,
            casesApproved: r.leftCasesApproved,
            toothNo: r.leftToothNo,
            ciSign: r.leftCi,
          });
        }
      });
      rows.forEach((r) => {
        if (r.rightDate || r.rightCasesApproved || r.rightToothNo || r.rightCi) {
          flatLog.push({
            date: r.rightDate,
            casesApproved: r.rightCasesApproved,
            toothNo: r.rightToothNo,
            ciSign: r.rightCi,
          });
        }
      });

      return {
        ...prev,
        treatmentLogRows: rows,
        treatmentLog: flatLog.length > 0 ? flatLog : prev.treatmentLog,
      };
    });
  };

  const updateComplaint = (index, value) => {
    if (readOnly) return;
    setForm((prev) => {
      const updated = [...prev.chiefComplaints];
      updated[index] = value;
      const nextVerified =
        prev.ocrConfidence?.chiefComplaints !== undefined
          ? { ...(prev.ocrVerifiedFields || {}), chiefComplaints: true }
          : prev.ocrVerifiedFields;
      return { ...prev, chiefComplaints: updated, ocrVerifiedFields: nextVerified };
    });
  };

  const updateDiagnosis = (index, value) => {
    if (readOnly) return;
    setForm((prev) => {
      const updated = [...prev.tentativeDiagnosis];
      updated[index] = value;
      const nextVerified =
        prev.ocrConfidence?.tentativeDiagnosis !== undefined
          ? { ...(prev.ocrVerifiedFields || {}), tentativeDiagnosis: true }
          : prev.ocrVerifiedFields;
      return { ...prev, tentativeDiagnosis: updated, ocrVerifiedFields: nextVerified };
    });
  };

  const updateTreatmentPlan = (index, value) => {
    if (readOnly) return;
    setForm((prev) => {
      const updated = [...prev.recommendedTreatmentPlan];
      updated[index] = value;
      const nextVerified =
        prev.ocrConfidence?.recommendedTreatmentPlan !== undefined
          ? { ...(prev.ocrVerifiedFields || {}), recommendedTreatmentPlan: true }
          : prev.ocrVerifiedFields;
      return {
        ...prev,
        recommendedTreatmentPlan: updated,
        ocrVerifiedFields: nextVerified,
      };
    });
  };

  const updateToothFinding = (toothKey, value) => {
    if (readOnly) return;
    setForm((prev) => {
      const nextVerified =
        prev.ocrConfidence?.teethFindings !== undefined
          ? { ...(prev.ocrVerifiedFields || {}), teethFindings: true }
          : prev.ocrVerifiedFields;
      return {
        ...prev,
        teethFindings: { ...(prev.teethFindings || {}), [toothKey]: value },
        ocrVerifiedFields: nextVerified,
      };
    });
  };

  const togglePastHistory = (conditionId) => {
    if (readOnly) return;
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
    if (readOnly) return;
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
    if (readOnly) return;
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

  // Local OpenAI whisper.cpp Voice Dictation
  const {
    recordingField,
    transcribingField,
    recordingSeconds,
    audioLevel,
    toggleFieldDictation: toggleDictation,
  } = useWhisperDictation({
    onTranscript: (field, transcript, result) => {
      setForm((prev) => ({
        ...prev,
        [field]: prev[field] ? `${prev[field]} ${transcript}` : transcript,
        ...(prev.ocrConfidence?.[field] !== undefined
          ? {
              ocrVerifiedFields: {
                ...(prev.ocrVerifiedFields || {}),
                [field]: true,
              },
            }
          : {}),
      }));
      setDictationTelemetry((prev) => ({
        engine: result?.provider || prev?.engine || "whisper.cpp",
        dictatedFields: Array.from(new Set([...(prev?.dictatedFields || []), field])),
        totalInferenceMs: (prev?.totalInferenceMs || 0) + Number(result?.durationMs || 0),
        lastModelId: result?.modelId || prev?.lastModelId || null,
      }));
    },
    onStatusChange: (msg) => {
      setOcrProgressText(msg);
      if (msg.startsWith("✓")) {
        setTimeout(() => setOcrProgressText(""), 5000);
      }
    },
    onError: (errMsg) => {
      setOcrProgressText(`✕ ${errMsg}`);
      setTimeout(() => setOcrProgressText(""), 5000);
    },
  });

  // OCR/ICR & Image Processing for Page 1 (Front: Demographics, Past History, Clinical Exam & Odontogram)
  const processPage1Image = async (fileOrUrl) => {
    setIsProcessingOcr(true);
    setOcrProgressText("Analyzing Page 1: Preparing scan & Odontogram crop...");

    try {
      let rawUrl = typeof fileOrUrl === "string" ? fileOrUrl : null;
      let blob = fileOrUrl;

      if (typeof fileOrUrl === "string") {
        const res = await fetch(fileOrUrl);
        blob = await res.blob();
      } else {
        const ext = fileOrUrl.type === "application/pdf" ? "pdf" : "jpg";
        rawUrl = await uploadOdfImageToStorage(fileOrUrl, `page1.${ext}`);
      }

      // 1. Region Cropping: Odontogram Block (Section C) when input is an image
      if (blob.type !== "application/pdf") {
        try {
          const odontoCrop = await cropImageRegion(blob, ODF_CROP_PRESETS.PAGE_1_ODONTOGRAM);
          const odontoCropUrl = await uploadOdfImageToStorage(
            odontoCrop.blob,
            "odonto.jpg"
          );

          setForm((prev) => ({
            ...prev,
            rawScanUrl: rawUrl || odontoCrop.dataUrl,
            odontogramCropUrl: odontoCropUrl || odontoCrop.dataUrl,
          }));
        } catch (cropErr) {
          console.warn("Odontogram crop skipped:", cropErr);
          if (rawUrl) {
            setForm((prev) => ({ ...prev, rawScanUrl: rawUrl }));
          }
        }
      } else if (rawUrl) {
        setForm((prev) => ({ ...prev, rawScanUrl: rawUrl }));
      }

      // 2. Cloud OCR/ICR via Microsoft Azure AI Document Intelligence (with local fallback)
      setOcrProgressText("Analyzing Page 1 with Azure AI Document Intelligence...");
      let usedAzure = false;

      try {
        const fileName =
          typeof fileOrUrl !== "string" && fileOrUrl?.name
            ? fileOrUrl.name
            : `page1_${form.eightDigitId}.jpg`;
        const azureRes = await analyzeOdfWithAzure(blob, 1, fileName);

        if (azureRes?.configured) {
          usedAzure = true;
          setForm((prev) => {
            const p1Updates = parseAzurePage1ToForm(azureRes, prev);
            // If user uploaded a multi-page PDF containing both Page 1 & Page 2, map Page 2 as well
            const p2Updates =
              (azureRes.pages?.length || 0) >= 2 ? parseAzurePage2ToForm(azureRes, prev) : {};
            const mergedUpdates = { ...p1Updates, ...p2Updates };
            const extractedScores = extractOcrConfidenceMap(azureRes, mergedUpdates, "azure-idp");
            const nextVerified = { ...(prev.ocrVerifiedFields || {}) };
            Object.keys(extractedScores).forEach((k) => {
              delete nextVerified[k];
            });
            const nextName = p1Updates.name || prev.name;
            const resolvedId = resolvePatientIdForName(nextName, prev.eightDigitId);
            return {
              ...prev,
              ...mergedUpdates,
              eightDigitId: resolvedId,
              ocrEngine: "azure-idp",
              ocrConfidence: { ...(prev.ocrConfidence || {}), ...extractedScores },
              ocrVerifiedFields: nextVerified,
            };
          });
        }
      } catch (azureErr) {
        console.warn("Azure Document Intelligence warning (falling back to local OCR):", azureErr);
      }

      // 3. Fallback to PaddleOCR (PP-OCRv5) if Azure credentials are not yet set or unavailable
      let usedPaddle = false;
      if (!usedAzure && blob.type !== "application/pdf") {
        setOcrProgressText("Running PaddleOCR fallback (PP-OCRv5) for Page 1...");
        try {
          const fileName =
            typeof fileOrUrl !== "string" && fileOrUrl?.name
              ? fileOrUrl.name
              : `page1_${form.eightDigitId}.jpg`;
          const paddleRes = await analyzeOdfWithPaddle(blob, 1, fileName);
          usedPaddle = true;

          setForm((prev) => {
            const p1Updates = parseAzurePage1ToForm(paddleRes, prev);
            const extractedScores = extractOcrConfidenceMap(paddleRes, p1Updates, "paddleocr");
            const nextVerified = { ...(prev.ocrVerifiedFields || {}) };
            Object.keys(extractedScores).forEach((k) => {
              delete nextVerified[k];
            });
            const nextName = p1Updates.name || prev.name;
            const resolvedId = resolvePatientIdForName(nextName, prev.eightDigitId);
            return {
              ...prev,
              ...p1Updates,
              eightDigitId: resolvedId,
              ocrEngine: "paddleocr",
              ocrConfidence: { ...(prev.ocrConfidence || {}), ...extractedScores },
              ocrVerifiedFields: nextVerified,
            };
          });
        } catch (ocrErr) {
          console.warn("PaddleOCR fallback warning:", ocrErr);
        }
      }

      setOcrProgressText(
        usedAzure
          ? "✓ Page 1 extracted via Azure Document Intelligence!"
          : usedPaddle
          ? "✓ Page 1 processed via PaddleOCR fallback (Odontogram cropped & fields extracted)!"
          : "✓ Page 1 processed (Odontogram cropped)."
      );
      setTimeout(() => setOcrProgressText(""), 5500);
    } catch (err) {
      console.error("Page 1 processing failed:", err);
      setOcrProgressText("✕ Error reading Page 1 scan. Please check file format.");
    } finally {
      setIsProcessingOcr(false);
    }
  };

  // OCR/ICR & Image Processing for Page 2 (Back: Diagnostic Tests, Diagnosis, 9x10 Log & Consent)
  const processPage2Image = async (fileOrUrl) => {
    setIsProcessingOcr(true);
    setOcrProgressText("Analyzing Page 2: Preparing scan & Consent block crop...");

    try {
      let rawUrl = typeof fileOrUrl === "string" ? fileOrUrl : null;
      let blob = fileOrUrl;

      if (typeof fileOrUrl === "string") {
        const res = await fetch(fileOrUrl);
        blob = await res.blob();
      } else {
        const ext = fileOrUrl.type === "application/pdf" ? "pdf" : "jpg";
        rawUrl = await uploadOdfImageToStorage(fileOrUrl, `page2.${ext}`);
      }

      // 1. Region Cropping: Signed Consent & Data Privacy Statement when input is an image
      if (blob.type !== "application/pdf") {
        try {
          const consentCrop = await cropImageRegion(blob, ODF_CROP_PRESETS.PAGE_2_CONSENT);
          const consentCropUrl = await uploadOdfImageToStorage(
            consentCrop.blob,
            "consent.jpg"
          );

          setForm((prev) => ({
            ...prev,
            rawScanPage2Url: rawUrl || consentCrop.dataUrl,
            consentCropUrl: consentCropUrl || consentCrop.dataUrl,
          }));
        } catch (cropErr) {
          console.warn("Consent crop skipped:", cropErr);
          if (rawUrl) {
            setForm((prev) => ({ ...prev, rawScanPage2Url: rawUrl }));
          }
        }
      } else if (rawUrl) {
        setForm((prev) => ({ ...prev, rawScanPage2Url: rawUrl }));
      }

      // 2. Cloud OCR/ICR & Table Extraction via Microsoft Azure AI Document Intelligence
      setOcrProgressText("Analyzing Page 2 tables & handwriting with Azure AI Document Intelligence...");
      let usedAzure = false;

      try {
        const fileName =
          typeof fileOrUrl !== "string" && fileOrUrl?.name
            ? fileOrUrl.name
            : `page2_${form.eightDigitId}.jpg`;
        const azureRes = await analyzeOdfWithAzure(blob, 2, fileName);

        if (azureRes?.configured) {
          usedAzure = true;
          setForm((prev) => {
            const p2Updates = parseAzurePage2ToForm(azureRes, prev);
            const extractedScores = extractOcrConfidenceMap(azureRes, p2Updates, "azure-idp");
            const nextVerified = { ...(prev.ocrVerifiedFields || {}) };
            Object.keys(extractedScores).forEach((k) => {
              delete nextVerified[k];
            });
            return {
              ...prev,
              ...p2Updates,
              ocrEngine: "azure-idp",
              ocrConfidence: { ...(prev.ocrConfidence || {}), ...extractedScores },
              ocrVerifiedFields: nextVerified,
            };
          });
        }
      } catch (azureErr) {
        console.warn("Azure Document Intelligence Page 2 warning (falling back to local OCR):", azureErr);
      }

      // 3. Fallback to PaddleOCR (PP-OCRv5) if Azure credentials are not yet set or unavailable
      let usedPaddle = false;
      if (!usedAzure && blob.type !== "application/pdf") {
        setOcrProgressText("Running PaddleOCR fallback (PP-OCRv5) for Page 2...");
        try {
          const fileName =
            typeof fileOrUrl !== "string" && fileOrUrl?.name
              ? fileOrUrl.name
              : `page2_${form.eightDigitId}.jpg`;
          const paddleRes = await analyzeOdfWithPaddle(blob, 2, fileName);
          usedPaddle = true;
          setForm((prev) => {
            const p2Updates = parseAzurePage2ToForm(paddleRes, prev);
            const extractedScores = extractOcrConfidenceMap(paddleRes, p2Updates, "paddleocr");
            const nextVerified = { ...(prev.ocrVerifiedFields || {}) };
            Object.keys(extractedScores).forEach((k) => {
              delete nextVerified[k];
            });
            return {
              ...prev,
              ...p2Updates,
              ocrEngine: "paddleocr",
              ocrConfidence: { ...(prev.ocrConfidence || {}), ...extractedScores },
              ocrVerifiedFields: nextVerified,
            };
          });
        } catch (ocrErr) {
          console.warn("PaddleOCR Page 2 fallback warning:", ocrErr);
        }
      }

      setOcrProgressText(
        usedAzure
          ? "✓ Page 2 tables & fields extracted via Azure Document Intelligence!"
          : usedPaddle
          ? "✓ Page 2 processed via PaddleOCR fallback! Signed consent block cropped and fields extracted."
          : "✓ Page 2 processed! Signed consent block cropped and linked."
      );
      setTimeout(() => setOcrProgressText(""), 5500);
    } catch (err) {
      console.error("Page 2 processing failed:", err);
      setOcrProgressText("✕ Error processing Page 2 scan.");
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

  const handleAddDiagnosticRow = () => {
    setForm((prev) => ({
      ...prev,
      diagnosticTests: [
        ...prev.diagnosticTests,
        { toothNo: "", mobility: "", palpation: "", percussion: "", cavity: "", hotTest: "", coldTest: "", anesthetic: "", electricPulp: "" },
      ],
    }));
  };

  const updateDiagnosticRow = (index, field, value) => {
    if (readOnly) return;
    setForm((prev) => {
      const tests = [...prev.diagnosticTests];
      tests[index] = { ...tests[index], [field]: value };
      return { ...prev, diagnosticTests: tests };
    });
  };

  const handleSaveForm = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const authenticatedClinician = currentUser?.name
      ? `${currentUser.name} (${currentUser.role})`
      : currentUser?.email || "";
    const activeClinician = form.clinician || authenticatedClinician;
    const submittedByEmail = currentUser?.email || "";

    const submissionPayload = {
      id: form.eightDigitId,
      eightDigitId: form.eightDigitId,
      submissionId: form.submissionId || `sub_${form.eightDigitId}_${Date.now()}`,
      name: (form.name || "").trim() || "Unnamed Patient",
      visitDate: form.date || form.examDate || getTodayManilaDisplay(),
      clinician: activeClinician,
      submittedBy: submittedByEmail,
      procedure: form.tentativeDiagnosis?.find(Boolean) || "Comprehensive Oral Examination & ODF",
      notes: form.historyOfPresentIllness || form.ciRemarks || "Digitized CEU Oral Diagnosis Form",
      rawScanUrl: form.rawScanUrl,
      rawScanPage2Url: form.rawScanPage2Url,
      odontogramCropUrl: form.odontogramCropUrl,
      consentCropUrl: form.consentCropUrl,
      odfDetails: {
        ...form,
        dictationTelemetry,
        approvalSignature: null,
        reviewFeedback: null,
        clinician: activeClinician,
        submittedBy: submittedByEmail,
        clinicianRole: currentUser?.role || "",
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
              📄 Page 1: ODF &amp; Odontogram
            </button>
            <button
              type="button"
              className={`ceu-odf-nav-btn ${activePage === "page2" ? "active" : ""}`}
              onClick={() => setActivePage("page2")}
            >
              📄 Page 2: Diagnostic &amp; Consent
            </button>
            {!hideFull2PageBtn && (
              <button
                type="button"
                className={`ceu-odf-nav-btn ${activePage === "all" ? "active" : ""}`}
                onClick={() => setActivePage("all")}
              >
                📜 Full 2-Page View
              </button>
            )}
            {(isSubmissionView || readOnly || form.rawScanUrl || form.rawScanPage2Url) && (
              <button
                type="button"
                className={`ceu-odf-nav-btn ${activePage === "uploaded" ? "active" : ""}`}
                onClick={() => setActivePage("uploaded")}
              >
                📷 View Uploaded Form
              </button>
            )}
          </div>

          <div className="ceu-odf-top-bar__actions">
            {readOnly ? (
              <>
                <span className="ceu-odf-readonly-pill">VIEW RECORD (2-PAGE ODF)</span>
                {!isStudent && onViewUploadedScans && (
                  <button
                    type="button"
                    className="ceu-btn-print"
                    onClick={onViewUploadedScans}
                    title="Open scanned ODF document image viewer (Page 1 & Page 2)"
                  >
                    🖼️ Uploaded ODF Images
                  </button>
                )}
                <button
                  type="button"
                  className="ceu-btn-print"
                  onClick={() => window.print()}
                  title="Print official CEU Oral Diagnosis Form"
                >
                  🖨️ Print Form
                </button>
                <button type="button" className="ceu-btn-secondary" onClick={onCancel}>
                  ✕ Close
                </button>
              </>
            ) : (
              <>
                <button type="button" className="ceu-btn-secondary" onClick={onCancel}>
                  Cancel
                </button>
                <button type="button" className="ceu-btn-primary" onClick={handleSaveForm}>
                  💾 Save & Submit Form
                </button>
              </>
            )}
          </div>
        </header>

        {/* OCR / Document Upload Tool Ribbon (hidden in read-only record view) */}
        {!readOnly && (
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
        )}

        {/* Form Body - Authentic Paper Replica of Centro Escolar University Oral Diagnosis Form */}
        <div className="ceu-odf-scroll-container">
          <div style={{ maxWidth: "900px", margin: "0 auto 12px" }}>
            <MedicalAlertBanner odfData={form} />

            {(() => {
              const ocrSummary = summarizeOcrConfidence(form);
              if (ocrSummary.totalScored === 0) return null;
              const engineLabel =
                form.ocrEngine === "azure-idp"
                  ? "MS Azure IDP"
                  : form.ocrEngine === "paddleocr"
                  ? "PaddleOCR Fallback"
                  : "OCR Extraction";
              const hasLowUnverified = ocrSummary.unverifiedFields.some(
                (f) => f.severity === "low"
              );
              const bannerBg =
                ocrSummary.unverifiedCount === 0
                  ? "#ecfdf5"
                  : hasLowUnverified
                  ? "#fef2f2"
                  : "#fffbeb";
              const bannerBorder =
                ocrSummary.unverifiedCount === 0
                  ? "#10b981"
                  : hasLowUnverified
                  ? "#dc2626"
                  : "#f59e0b";
              const bannerText =
                ocrSummary.unverifiedCount === 0
                  ? "#065f46"
                  : hasLowUnverified
                  ? "#991b1b"
                  : "#92400e";

              return (
                <div
                  role="region"
                  aria-label="OCR Extraction Confidence"
                  style={{
                    background: bannerBg,
                    border: `1.5px solid ${bannerBorder}`,
                    borderRadius: "10px",
                    padding: "11px 15px",
                    marginTop: "10px",
                    color: bannerText,
                    fontSize: "12.5px",
                    lineHeight: "1.5",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "8px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span
                        style={{
                          background: "#0f172a",
                          color: "#ffffff",
                          fontSize: "11px",
                          fontWeight: 800,
                          padding: "2px 8px",
                          borderRadius: "999px",
                        }}
                      >
                        {engineLabel}
                      </span>
                      <strong style={{ fontSize: "13px" }}>
                        OCR Extraction Confidence
                      </strong>
                      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {ocrSummary.totalScored} scored · {ocrSummary.flaggedCount} flagged (&lt;85%) ·{" "}
                        {ocrSummary.unverifiedCount} unverified
                      </span>
                    </div>

                    {readOnly && ocrSummary.unverifiedCount > 0 && onViewUploadedScans && (
                      <button
                        type="button"
                        onClick={onViewUploadedScans}
                        style={{
                          background: "#ffffff",
                          border: `1px solid ${bannerBorder}`,
                          color: bannerText,
                          borderRadius: "8px",
                          padding: "5px 11px",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Compare with Uploaded Scan
                      </button>
                    )}
                  </div>

                  {ocrSummary.unverifiedCount > 0 && (
                    <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: "11.5px" }}>
                        {readOnly ? "Unverified OCR fields:" : "Verify or edit highlighted fields:"}
                      </span>
                      {ocrSummary.unverifiedFields.map((item) => {
                        const isLow = item.severity === "low";
                        return (
                          <span
                            key={item.field}
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              fontVariantNumeric: "tabular-nums",
                              padding: "2px 8px",
                              borderRadius: "999px",
                              background: "#ffffff",
                              color: isLow ? "#b91c1c" : "#b45309",
                              border: `1px solid ${isLow ? "#fca5a5" : "#fcd34d"}`,
                            }}
                          >
                            {OCR_FIELD_LABELS[item.field] || item.field} ({Math.round(item.score * 100)}%)
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {activeRevisionFeedback && (() => {
              const rubricMap = activeRevisionFeedback.rubric || {};
              const flaggedDomains = DECLINE_RUBRIC_DOMAINS.filter(
                (d) => rubricMap[d.id] === "needs_revision"
              );
              return (
                <div
                  role="region"
                  aria-label="Faculty Revision Feedback"
                  style={{
                    background: "#fffbeb",
                    border: "1.5px solid #f59e0b",
                    borderRadius: "10px",
                    padding: "12px 16px",
                    marginTop: "10px",
                    color: "#78350f",
                    fontSize: "12.5px",
                    lineHeight: "1.5",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "6px" }}>
                    <strong style={{ fontSize: "13px", color: "#92400e" }}>
                      Faculty Revision Instructions
                    </strong>
                    <span style={{ fontSize: "11.5px", color: "#b45309", fontWeight: "600" }}>
                      {activeRevisionFeedback.reviewerName ? `Reviewed by ${activeRevisionFeedback.reviewerName}` : "Returned by Supervising Faculty"}
                      {activeRevisionFeedback.reviewedAt ? ` · ${formatSignatureTimestamp(activeRevisionFeedback.reviewedAt)}` : ""}
                    </span>
                  </div>
                  {flaggedDomains.length > 0 && (
                    <div style={{ marginBottom: "6px" }}>
                      <div style={{ fontWeight: "700", fontSize: "11.5px", color: "#92400e", marginBottom: "4px" }}>
                        Flagged Domains Requiring Revision:
                      </div>
                      <ul style={{ margin: 0, paddingLeft: "18px", display: "grid", gap: "2px" }}>
                        {flaggedDomains.map((d) => (
                          <li key={d.id} style={{ fontWeight: "600" }}>
                            {d.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {activeRevisionFeedback.comments && (
                    <div
                      style={{
                        background: "#ffffff",
                        border: "1px solid #fde68a",
                        borderRadius: "8px",
                        padding: "8px 10px",
                        color: "#0f172a",
                        fontSize: "12.5px",
                      }}
                    >
                      <strong style={{ color: "#92400e" }}>Clinical Remarks:</strong>{" "}
                      {activeRevisionFeedback.comments}
                    </div>
                  )}
                </div>
              );
            })()}

            {form.approvalSignature && (
              signatureStatus === "tampered" ? (
                <div
                  role="alert"
                  style={{
                    background: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)",
                    border: "2px solid #b91c1c",
                    borderRadius: "10px",
                    padding: "10px 14px",
                    color: "#7f1d1d",
                    fontSize: "12.5px",
                    fontWeight: "700",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    boxShadow: "0 4px 10px rgba(185, 28, 28, 0.16)",
                  }}
                >
                  <span>⚠️ TAMPER-EVIDENCE ALERT: Record contents no longer match the faculty-signed SHA-256 digest!</span>
                </div>
              ) : signatureStatus === "verified" ? (
                <div
                  role="status"
                  style={{
                    background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
                    border: "1.5px solid #10b981",
                    borderRadius: "10px",
                    padding: "10px 14px",
                    color: "#065f46",
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "8px",
                    boxShadow: "0 2px 8px rgba(16, 185, 129, 0.12)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span
                      style={{
                        background: "#059669",
                        color: "#ffffff",
                        fontWeight: "800",
                        fontSize: "11px",
                        padding: "3px 8px",
                        borderRadius: "6px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      🛡️ VERIFIED FACULTY E-SIGNATURE
                    </span>
                    <span>
                      Digitally Signed by{" "}
                      <strong>{form.approvalSignature.signedBy || "Supervising Faculty"}</strong>
                      {(form.approvalSignature.employeeId || form.approvalSignature.employee_id) && (
                        <> (ID: {form.approvalSignature.employeeId || form.approvalSignature.employee_id})</>
                      )}
                    </span>
                    {(form.approvalSignature.signedAt || form.approvalSignature.timestamp) && (
                      <span style={{ color: "#047857" }}>
                        • {formatSignatureTimestamp(form.approvalSignature.signedAt || form.approvalSignature.timestamp)}
                      </span>
                    )}
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: "11px", color: "#047857", fontWeight: "700" }}>
                    Ledger #{form.approvalSignature.ledgerSeq ?? "—"} • SHA-256:{" "}
                    {form.approvalSignature.ledgerEntryHash
                      ? `${String(form.approvalSignature.ledgerEntryHash).slice(0, 16)}...`
                      : "N/A"}
                  </div>
                </div>
              ) : (
                <div
                  role="status"
                  style={{
                    background: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    borderRadius: "10px",
                    padding: "8px 14px",
                    color: "#475569",
                    fontSize: "12px",
                    fontWeight: "600",
                  }}
                >
                  🛡️ Verifying faculty e-signature SHA-256 integrity...
                </div>
              )
            )}
          </div>

          <form onSubmit={handleSaveForm} className={`ceu-odf-paper-form ${readOnly ? "ceu-odf-paper-form--readonly" : ""}`}>

            {/* ================= PAGE 1 ================= */}
            {(activePage === "page1" || activePage === "all") && (
              <div className="ceu-paper-sheet ceu-paper-sheet--page1">
                {/* Official University Header */}
                <header className="ceu-official-header">
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
                  {!readOnly && matchedPatientInfo && (
                    <div
                      role="status"
                      style={{
                        background: "#fdf2f8",
                        border: "1px solid #f9a8d4",
                        color: "#9d174d",
                        borderRadius: "8px",
                        padding: "6px 12px",
                        marginBottom: "8px",
                        fontSize: "12px",
                        fontWeight: 600,
                      }}
                    >
                      Existing patient matched: <strong>{matchedPatientInfo.name}</strong> (Patient ID #{to8DigitId(matchedPatientInfo.id)}) — This submission will be added to their existing record history.
                    </div>
                  )}
                  {/* Row 1: Name, Home Address (No Date field) */}
                  <div className="ceu-form-row ceu-form-row--row1">
                    <div className="ceu-field ceu-field--name" style={{ flexWrap: "wrap" }}>
                      <span className="ceu-label">Name:</span>
                      <input
                        type="text"
                        className="ceu-line-input ceu-line-input--bold"
                        style={getOcrInputStyle("name")}
                        value={form.name}
                        onChange={(e) => updateField("name", e.target.value)}
                        placeholder="Last Name, First Name Middle Initial"
                        required
                      />
                      {renderOcrBadge("name")}
                    </div>
                    <div className="ceu-field ceu-field--home-address" style={{ flexWrap: "wrap" }}>
                      <span className="ceu-label">Home Address:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        style={getOcrInputStyle("homeAddress")}
                        value={form.homeAddress}
                        onChange={(e) => updateField("homeAddress", e.target.value)}
                        placeholder="House No., Street, Barangay, City"
                      />
                      {renderOcrBadge("homeAddress")}
                    </div>
                  </div>

                  {/* Row 2: Birthdate, Age, Sex, Ht, Wt, Civil Status */}
                  <div className="ceu-form-row ceu-form-row--row2">
                    <div className="ceu-field ceu-field--birthdate" style={{ flexWrap: "wrap" }}>
                      <span className="ceu-label">Birthdate:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        style={getOcrInputStyle("birthDate")}
                        value={form.birthDate}
                        onChange={(e) => updateField("birthDate", e.target.value)}
                        placeholder="MM/DD/YYYY"
                      />
                      {renderOcrBadge("birthDate")}
                    </div>
                    <div className="ceu-field ceu-field--age" style={{ flexWrap: "wrap" }}>
                      <span className="ceu-label">Age:</span>
                      <input
                        type="number"
                        className="ceu-line-input"
                        style={getOcrInputStyle("age")}
                        value={form.age}
                        onChange={(e) => updateField("age", e.target.value)}
                        placeholder="Yrs"
                      />
                      {renderOcrBadge("age")}
                    </div>
                    <div className="ceu-field ceu-field--sex" style={{ flexWrap: "wrap" }}>
                      <span className="ceu-label">Sex:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        style={getOcrInputStyle("sex")}
                        value={form.sex}
                        onChange={(e) => updateField("sex", e.target.value)}
                        placeholder="M / F"
                      />
                      {renderOcrBadge("sex")}
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
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.civilStatus}
                        onChange={(e) => updateField("civilStatus", e.target.value)}
                      />
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
                    <div className="ceu-field ceu-field--cell-phone" style={{ flexWrap: "wrap" }}>
                      <span className="ceu-label">Cell Phone No.:</span>
                      <input
                        type="tel"
                        className="ceu-line-input"
                        style={getOcrInputStyle("cellPhone")}
                        value={form.cellPhone}
                        onChange={(e) => updateField("cellPhone", e.target.value)}
                        placeholder="09XX-XXX-XXXX"
                      />
                      {renderOcrBadge("cellPhone")}
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

                  <div className="ceu-subheading" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <strong>A. Chief Complaint/s:</strong>
                    {renderOcrBadge("chiefComplaints")}
                  </div>
                  <div className="ceu-ruled-lines-group">
                    {form.chiefComplaints.map((complaint, idx) => (
                      <div className="ceu-ruled-line-item" key={`complaint-${idx}`}>
                        <span className="ceu-line-num">{idx + 1}.</span>
                        <input
                          type="text"
                          className="ceu-ruled-input"
                          style={getOcrInputStyle("chiefComplaints")}
                          value={complaint}
                          onChange={(e) => updateComplaint(idx, e.target.value)}
                          placeholder={idx === 0 ? "e.g. Tooth sensitivity on lower molar during cold food intake" : ""}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="ceu-subheading ceu-subheading--with-action" style={{ gap: "8px", flexWrap: "wrap" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <strong>B. History of Present Illness:</strong>
                      {renderOcrBadge("historyOfPresentIllness")}
                    </div>
                    {!readOnly && (
                      <button
                        type="button"
                        disabled={Boolean(transcribingField)}
                        className={`ceu-mic-btn ${
                          recordingField === "historyOfPresentIllness"
                            ? "listening"
                            : transcribingField === "historyOfPresentIllness"
                            ? "transcribing"
                            : ""
                        }`}
                        onClick={() => toggleDictation("historyOfPresentIllness")}
                        title="Dictate locally with OpenAI whisper.cpp"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {recordingField === "historyOfPresentIllness"
                          ? `⏹ Stop & Transcribe (${recordingSeconds}s · ${audioLevel}%)`
                          : transcribingField === "historyOfPresentIllness"
                          ? "⏳ Whisper.cpp..."
                          : "🎙️ Dictate"}
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={3}
                    className="ceu-ruled-textarea"
                    style={getOcrInputStyle("historyOfPresentIllness")}
                    value={form.historyOfPresentIllness}
                    onChange={(e) => updateField("historyOfPresentIllness", e.target.value)}
                    placeholder={readOnly ? "" : "Describe onset, duration, character, and exacerbating factors..."}
                  />
                </section>

                {/* C. PAST HISTORY Table */}
                <section className="ceu-section ceu-section--past-history">
                  <div className="ceu-subheading ceu-subheading--between">
                    <strong>C. Past History: Mark(/) if any conditions are present and (X) if none.</strong>
                    {!readOnly && (
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
                    )}
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
                      <div className="ceu-bottom-col ceu-bottom-col--allergy" style={{ flexWrap: "wrap" }}>
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
                          style={getOcrInputStyle("allergySpecify")}
                          value={form.allergySpecify}
                          onChange={(e) => {
                            const val = e.target.value;
                            setForm((prev) => ({
                              ...prev,
                              allergySpecify: val,
                              allergyCheck: val.trim() ? "present" : prev.allergyCheck,
                              ocrVerifiedFields:
                                prev.ocrConfidence?.allergySpecify !== undefined
                                  ? { ...(prev.ocrVerifiedFields || {}), allergySpecify: true }
                                  : prev.ocrVerifiedFields,
                            }));
                          }}
                          placeholder="e.g. Penicillin, Food"
                        />
                        {renderOcrBadge("allergySpecify")}
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
                    <div className="ceu-form-row" style={{ marginBottom: "8px" }}>
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
                      <div className="ceu-field ceu-field--grow">
                        <span className="ceu-label">If yes when?</span>
                        <input
                          type="text"
                          className="ceu-line-input"
                          value={form.extractionWhen}
                          onChange={(e) => updateField("extractionWhen", e.target.value)}
                          placeholder="Month/Year or Date"
                        />
                      </div>
                    </div>

                    {/* Denture Section: Upper above, Lower below, both with checkbox before Upper and Lower, Type____ and since____ */}
                    <div className="ceu-denture-block" style={{ borderTop: "1px dashed #cbd5e1", paddingTop: "8px" }}>
                      <div className="ceu-denture-row" style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap", marginBottom: "6px" }}>
                        <span className="ceu-label" style={{ minWidth: "60px" }}>Denture:</span>
                        
                        <label style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", cursor: "pointer", marginRight: "6px" }}>
                          <input
                            type="checkbox"
                            checked={form.dentureUpperNone}
                            onChange={(e) => updateField("dentureUpperNone", e.target.checked)}
                          />
                          <span>None</span>
                        </label>

                        <div className="ceu-field" style={{ flex: "1 1 210px", display: "inline-flex", alignItems: "baseline", gap: "6px" }}>
                          <input
                            type="checkbox"
                            checked={form.dentureUpperCheck}
                            onChange={(e) => updateField("dentureUpperCheck", e.target.checked)}
                            title="Select Upper Denture"
                          />
                          <span className="ceu-label">Upper: Type</span>
                          <input
                            type="text"
                            className="ceu-line-input"
                            value={form.dentureUpperType}
                            onChange={(e) => updateField("dentureUpperType", e.target.value)}
                            placeholder="Full / Partial / —"
                          />
                        </div>

                        <div className="ceu-field" style={{ flex: "1 1 180px" }}>
                          <span className="ceu-label">since</span>
                          <input
                            type="text"
                            className="ceu-line-input"
                            value={form.dentureUpperSince}
                            onChange={(e) => updateField("dentureUpperSince", e.target.value)}
                            placeholder="Duration or Date"
                          />
                        </div>
                      </div>

                      <div className="ceu-denture-row" style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                        <span style={{ minWidth: "60px" }}></span>
                        
                        <label style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", cursor: "pointer", marginRight: "6px" }}>
                          <input
                            type="checkbox"
                            checked={form.dentureLowerNone}
                            onChange={(e) => updateField("dentureLowerNone", e.target.checked)}
                          />
                          <span>None</span>
                        </label>

                        <div className="ceu-field" style={{ flex: "1 1 210px", display: "inline-flex", alignItems: "baseline", gap: "6px" }}>
                          <input
                            type="checkbox"
                            checked={form.dentureLowerCheck}
                            onChange={(e) => updateField("dentureLowerCheck", e.target.checked)}
                            title="Select Lower Denture"
                          />
                          <span className="ceu-label">Lower: Type</span>
                          <input
                            type="text"
                            className="ceu-line-input"
                            value={form.dentureLowerType}
                            onChange={(e) => updateField("dentureLowerType", e.target.value)}
                            placeholder="Full / Partial / —"
                          />
                        </div>

                        <div className="ceu-field" style={{ flex: "1 1 180px" }}>
                          <span className="ceu-label">since</span>
                          <input
                            type="text"
                            className="ceu-line-input"
                            value={form.dentureLowerSince}
                            onChange={(e) => updateField("dentureLowerSince", e.target.value)}
                            placeholder="Duration or Date"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* II. CLINICAL EXAMINATION */}
                <section className="ceu-section">
                  <div className="ceu-section-header">
                    <h4>II. CLINICAL EXAMINATION</h4>
                  </div>

                  {/* Extraoral: Head, TMJ, and Eyes below TMJ */}
                  <div className="ceu-subheading">
                    <strong>A. Extraoral:</strong>
                  </div>
                  <div className="ceu-extraoral-grid" style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
                    {/* Row 1: Head */}
                    <div style={{ display: "flex", alignItems: "baseline", gap: "6px", flexWrap: "wrap" }}>
                      <span className="ceu-label" style={{ minWidth: "48px" }}>Head:</span>
                      <div style={{ display: "inline-flex", alignItems: "baseline", gap: "4px" }}>
                        <input
                          type="text"
                          className="ceu-line-input"
                          style={{ width: "36px", textAlign: "center" }}
                          value={form.headNormal}
                          onChange={(e) => updateField("headNormal", e.target.value)}
                          placeholder="/"
                          title="Mark (/) or (X) for Normal"
                        />
                        <span style={{ fontSize: "11.5px" }}>Normal</span>
                      </div>

                      <div style={{ display: "inline-flex", alignItems: "baseline", gap: "4px" }}>
                        <input
                          type="text"
                          className="ceu-line-input"
                          style={{ width: "32px", textAlign: "center", flex: "none" }}
                          value={form.head}
                          onChange={(e) => updateField("head", e.target.value)}
                          placeholder="X"
                          title="Mark for Abnormal"
                        />
                        <span style={{ fontSize: "11.5px", whiteSpace: "nowrap" }}>Abnormal, specify</span>
                        <input
                          type="text"
                          className="ceu-line-input"
                          style={{ width: "110px", flex: "none" }}
                          value={form.headAbnormalSpecify}
                          onChange={(e) => updateField("headAbnormalSpecify", e.target.value)}
                          placeholder="N/A"
                        />
                      </div>
                    </div>

                    {/* Row 2: TMJ below Head */}
                    <div style={{ display: "flex", alignItems: "baseline", gap: "6px", flexWrap: "wrap" }}>
                      <span className="ceu-label" style={{ minWidth: "48px" }}>TMJ:</span>
                      <div style={{ display: "inline-flex", alignItems: "baseline", gap: "4px" }}>
                        <input
                          type="text"
                          className="ceu-line-input"
                          style={{ width: "36px", textAlign: "center" }}
                          value={form.tmjNormal}
                          onChange={(e) => updateField("tmjNormal", e.target.value)}
                          placeholder="/"
                          title="Mark (/) or (X) for Normal"
                        />
                        <span style={{ fontSize: "11.5px" }}>Normal</span>
                      </div>

                      <div style={{ display: "inline-flex", alignItems: "baseline", gap: "4px" }}>
                        <input
                          type="text"
                          className="ceu-line-input"
                          style={{ width: "32px", textAlign: "center", flex: "none" }}
                          value={form.tmj}
                          onChange={(e) => updateField("tmj", e.target.value)}
                          placeholder="X"
                          title="Mark for Abnormal"
                        />
                        <span style={{ fontSize: "11.5px", whiteSpace: "nowrap" }}>Abnormal, specify</span>
                        <input
                          type="text"
                          className="ceu-line-input"
                          style={{ width: "110px", flex: "none" }}
                          value={form.tmjAbnormalSpecify}
                          onChange={(e) => updateField("tmjAbnormalSpecify", e.target.value)}
                          placeholder="N/A"
                        />
                      </div>
                    </div>

                    {/* Row 3: Eyes below TMJ */}
                    <div style={{ display: "flex", alignItems: "baseline", gap: "6px", flexWrap: "wrap" }}>
                      <span className="ceu-label" style={{ minWidth: "48px" }}>Eyes:</span>
                      <div style={{ display: "inline-flex", alignItems: "baseline", gap: "4px" }}>
                        <input
                          type="text"
                          className="ceu-line-input"
                          style={{ width: "36px", textAlign: "center" }}
                          value={form.eyesNormal}
                          onChange={(e) => updateField("eyesNormal", e.target.value)}
                          placeholder="/"
                          title="Mark (/) or (X) for Normal"
                        />
                        <span style={{ fontSize: "11.5px" }}>Normal</span>
                      </div>

                      <div style={{ display: "inline-flex", alignItems: "baseline", gap: "4px" }}>
                        <input
                          type="text"
                          className="ceu-line-input"
                          style={{ width: "32px", textAlign: "center", flex: "none" }}
                          value={form.eyes}
                          onChange={(e) => updateField("eyes", e.target.value)}
                          placeholder="X"
                          title="Mark for Abnormal"
                        />
                        <span style={{ fontSize: "11.5px", whiteSpace: "nowrap" }}>Abnormal, specify</span>
                        <input
                          type="text"
                          className="ceu-line-input"
                          style={{ width: "110px", flex: "none" }}
                          value={form.eyesAbnormalSpecify}
                          onChange={(e) => updateField("eyesAbnormalSpecify", e.target.value)}
                          placeholder="N/A"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Vital Signs Row */}
                  <div className="ceu-vitals-strip">
                    <div className="ceu-field ceu-field--vital" style={{ flexWrap: "wrap" }}>
                      <span className="ceu-label">BP:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        style={getOcrInputStyle("bloodPressure")}
                        value={form.bloodPressure}
                        onChange={(e) => updateField("bloodPressure", e.target.value)}
                        placeholder=""
                      />
                      {renderOcrBadge("bloodPressure")}
                    </div>
                    <div className="ceu-field ceu-field--vital" style={{ flexWrap: "wrap" }}>
                      <span className="ceu-label">Pulse Rate:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        style={getOcrInputStyle("pulseRate")}
                        value={form.pulseRate}
                        onChange={(e) => updateField("pulseRate", e.target.value)}
                        placeholder=""
                      />
                      {renderOcrBadge("pulseRate")}
                    </div>
                    <div className="ceu-field ceu-field--vital">
                      <span className="ceu-label">Resp. Rate:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.respiratoryRate}
                        onChange={(e) => updateField("respiratoryRate", e.target.value)}
                        placeholder=""
                      />
                    </div>
                    <div className="ceu-field ceu-field--vital">
                      <span className="ceu-label">Temperature:</span>
                      <input
                        type="text"
                        className="ceu-line-input"
                        value={form.temperature}
                        onChange={(e) => updateField("temperature", e.target.value)}
                        placeholder=""
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
                  <div className="ceu-section-header ceu-section-header--between" style={{ gap: "8px", flexWrap: "wrap" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <h4>C. MOUTH EXAMINATION (ODONTOGRAM)</h4>
                      {renderOcrBadge("teethFindings")}
                    </div>
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
                          {resolvedScans.odontogramCropUrl && (
                            <button
                              type="button"
                              className="ceu-preview-zoom-btn"
                              onClick={() => setExpandedImage(resolvedScans.odontogramCropUrl)}
                            >
                              🔍 Zoom & Inspect
                            </button>
                          )}
                          {!readOnly && (
                            <button
                              type="button"
                              className="ceu-recrop-btn"
                              onClick={() => fileInputPage1Ref.current?.click()}
                            >
                              🔄 Re-upload / Crop
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="ceu-cropped-image-wrapper">
                        {isLoadingScans && !resolvedScans.odontogramCropUrl ? (
                          <div className="ceu-ocr-status-bar" role="status">
                            <span className="ceu-spinner" />
                            <span>Loading secure odontogram scan...</span>
                          </div>
                        ) : resolvedScans.odontogramCropUrl ? (
                          <img
                            src={resolvedScans.odontogramCropUrl}
                            alt="Cropped CEU Mouth Examination Odontogram"
                            className="ceu-cropped-odonto-img"
                          />
                        ) : (
                          <div className="ceu-uploaded-empty">
                            <p>Unable to load scanned odontogram image.</p>
                          </div>
                        )}
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
                                style={getOcrInputStyle("teethFindings")}
                                value={form.teethFindings[t] || ""}
                                onChange={(e) => updateToothFinding(t, e.target.value)}
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
                                style={getOcrInputStyle("teethFindings")}
                                value={form.teethFindings[t] || ""}
                                onChange={(e) => updateToothFinding(t, e.target.value)}
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
                                style={getOcrInputStyle("teethFindings")}
                                value={form.teethFindings[t] || ""}
                                onChange={(e) => updateToothFinding(t, e.target.value)}
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
                                style={getOcrInputStyle("teethFindings")}
                                value={form.teethFindings[t] || ""}
                                onChange={(e) => updateToothFinding(t, e.target.value)}
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
                    {!readOnly && (
                      <button
                        type="button"
                        className="ceu-table-add-btn"
                        onClick={handleAddDiagnosticRow}
                      >
                        + Add Tooth Test Row
                      </button>
                    )}
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
                                placeholder=""
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.mobility}
                                onChange={(e) => updateDiagnosticRow(rIdx, "mobility", e.target.value)}
                                placeholder=""
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.palpation || ""}
                                onChange={(e) => updateDiagnosticRow(rIdx, "palpation", e.target.value)}
                                placeholder=""
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.percussion}
                                onChange={(e) => updateDiagnosticRow(rIdx, "percussion", e.target.value)}
                                placeholder=""
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.cavity}
                                onChange={(e) => updateDiagnosticRow(rIdx, "cavity", e.target.value)}
                                placeholder=""
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.hotTest}
                                onChange={(e) => updateDiagnosticRow(rIdx, "hotTest", e.target.value)}
                                placeholder=""
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.coldTest}
                                onChange={(e) => updateDiagnosticRow(rIdx, "coldTest", e.target.value)}
                                placeholder=""
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.anesthetic}
                                onChange={(e) => updateDiagnosticRow(rIdx, "anesthetic", e.target.value)}
                                placeholder=""
                              />
                            </td>
                            <td>
                              <input
                                className="ceu-table-cell-input"
                                value={row.electricPulp}
                                onChange={(e) => updateDiagnosticRow(rIdx, "electricPulp", e.target.value)}
                                placeholder=""
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
                    {!readOnly && (
                      <button
                        type="button"
                        disabled={Boolean(transcribingField)}
                        className={`ceu-mic-btn ${
                          recordingField === "radiographicInterpretation"
                            ? "listening"
                            : transcribingField === "radiographicInterpretation"
                            ? "transcribing"
                            : ""
                        }`}
                        onClick={() => toggleDictation("radiographicInterpretation")}
                        title="Dictate locally with OpenAI whisper.cpp"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {recordingField === "radiographicInterpretation"
                          ? `⏹ Stop & Transcribe (${recordingSeconds}s · ${audioLevel}%)`
                          : transcribingField === "radiographicInterpretation"
                          ? "⏳ Whisper.cpp..."
                          : "🎙️ Dictate"}
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    className="ceu-ruled-textarea"
                    value={form.radiographicInterpretation}
                    onChange={(e) => updateField("radiographicInterpretation", e.target.value)}
                    placeholder=""
                  />
                </section>

                {/* Tentative Diagnosis & Recommended Treatment Plan Side-by-Side */}
                <section className="ceu-section">
                  <div className="ceu-diagnosis-plan-grid">
                    <div className="ceu-col-plan">
                      <div className="ceu-subheading" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <strong>Tentative Diagnosis:</strong>
                        {renderOcrBadge("tentativeDiagnosis")}
                      </div>
                      <div className="ceu-ruled-lines-group">
                        {form.tentativeDiagnosis.map((item, idx) => (
                          <div className="ceu-ruled-line-item" key={`diag-${idx}`}>
                            <span className="ceu-line-num">{idx + 1}.</span>
                            <input
                              type="text"
                              className="ceu-ruled-input"
                              style={getOcrInputStyle("tentativeDiagnosis")}
                              value={item}
                              onChange={(e) => updateDiagnosis(idx, e.target.value)}
                              placeholder=""
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="ceu-col-plan">
                      <div className="ceu-subheading" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <strong>Recommended Treatment Plan:</strong>
                        {renderOcrBadge("recommendedTreatmentPlan")}
                      </div>
                      <div className="ceu-ruled-lines-group">
                        {form.recommendedTreatmentPlan.map((item, idx) => (
                          <div className="ceu-ruled-line-item" key={`treat-${idx}`}>
                            <span className="ceu-line-num">{idx + 1}.</span>
                            <input
                              type="text"
                              className="ceu-ruled-input"
                              style={getOcrInputStyle("recommendedTreatmentPlan")}
                              value={item}
                              onChange={(e) => updateTreatmentPlan(idx, e.target.value)}
                              placeholder=""
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
                        placeholder=""
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
                        placeholder=""
                      />
                    </div>
                  </div>
                </section>

                {/* 9 columns x 10 rows Treatment / Cases Approval Ledger Table */}
                <section className="ceu-section ceu-section--treatment-ledger">
                  <div className="ceu-table-responsive">
                    <table className="ceu-bordered-table ceu-treatment-ledger-table">
                      <thead>
                        <tr>
                          <th style={{ width: "11%" }}>Date</th>
                          <th style={{ width: "23%" }}>Cases/Approved</th>
                          <th style={{ width: "8%" }}>Tooth No.</th>
                          <th style={{ width: "7%" }}>O.D. C.I</th>
                          <th className="ceu-table-divider-col" style={{ width: "2%" }}></th>
                          <th style={{ width: "11%" }}>Date</th>
                          <th style={{ width: "23%" }}>Cases/Approved</th>
                          <th style={{ width: "8%" }}>Tooth No.</th>
                          <th style={{ width: "7%" }}>O.D. C.I</th>
                        </tr>
                      </thead>
                      <tbody>
                        {form.treatmentLogRows.map((row, rIdx) => (
                          <tr key={`ledger-row-${rIdx}`}>
                            <td>
                              <input
                                type="text"
                                className="ceu-table-cell-input"
                                value={row.leftDate}
                                onChange={(e) => updateTreatmentLogRow(rIdx, "leftDate", e.target.value)}
                                placeholder=""
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                className="ceu-table-cell-input ceu-table-cell-input--left"
                                value={row.leftCasesApproved}
                                onChange={(e) => updateTreatmentLogRow(rIdx, "leftCasesApproved", e.target.value)}
                                placeholder=""
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                className="ceu-table-cell-input"
                                value={row.leftToothNo}
                                onChange={(e) => updateTreatmentLogRow(rIdx, "leftToothNo", e.target.value)}
                                placeholder=""
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                className="ceu-table-cell-input"
                                value={row.leftCi}
                                onChange={(e) => updateTreatmentLogRow(rIdx, "leftCi", e.target.value)}
                                placeholder=""
                              />
                            </td>
                            <td className="ceu-table-divider-cell"></td>
                            <td>
                              <input
                                type="text"
                                className="ceu-table-cell-input"
                                value={row.rightDate}
                                onChange={(e) => updateTreatmentLogRow(rIdx, "rightDate", e.target.value)}
                                placeholder=""
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                className="ceu-table-cell-input ceu-table-cell-input--left"
                                value={row.rightCasesApproved}
                                onChange={(e) => updateTreatmentLogRow(rIdx, "rightCasesApproved", e.target.value)}
                                placeholder=""
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                className="ceu-table-cell-input"
                                value={row.rightToothNo}
                                onChange={(e) => updateTreatmentLogRow(rIdx, "rightToothNo", e.target.value)}
                                placeholder=""
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                className="ceu-table-cell-input"
                                value={row.rightCi}
                                onChange={(e) => updateTreatmentLogRow(rIdx, "rightCi", e.target.value)}
                                placeholder=""
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* CI's Remarks moved below the table */}
                  <div className="ceu-ci-remarks-container" style={{ marginTop: "12px" }}>
                    <div className="ceu-subheading ceu-subheading--with-action" style={{ gap: "8px", flexWrap: "wrap" }}>
                      <strong>CI's Remarks:</strong>
                      {!readOnly && (
                        <button
                          type="button"
                          disabled={Boolean(transcribingField)}
                          className={`ceu-mic-btn ${
                            recordingField === "ciRemarks"
                              ? "listening"
                              : transcribingField === "ciRemarks"
                              ? "transcribing"
                              : ""
                          }`}
                          onClick={() => toggleDictation("ciRemarks")}
                          title="Dictate locally with OpenAI whisper.cpp"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {recordingField === "ciRemarks"
                            ? `⏹ Stop & Transcribe (${recordingSeconds}s · ${audioLevel}%)`
                            : transcribingField === "ciRemarks"
                            ? "⏳ Whisper.cpp..."
                            : "🎙️ Dictate"}
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={3}
                      className="ceu-ruled-textarea"
                      value={form.ciRemarks}
                      onChange={(e) => updateField("ciRemarks", e.target.value)}
                      placeholder={readOnly ? "" : "Record clinical instructor notes, case evaluation, or dictation..."}
                    />
                  </div>
                </section>

                {/* DATA PRIVACY ACT STATEMENT POLICY */}
                <section className="ceu-section ceu-section--privacy">
                  <div className="ceu-privacy-statement-box">
                    <h5>DATA PRIVACY ACT STATEMENT POLICY</h5>
                    <p>
                      Centro Escolar University is committed to respecting and protecting the privacy rights of individuals in accordance with Republic Act No. 10173 (Data Privacy Act of 2012) and its Implementing Rules and Regulations. We adhere to the core principles of transparency, legitimate purpose, and proportionality. In submitting digital diagnostic records and Oral Diagnosis Forms (ODFs), patients and clinicians are informed that automated image recognition and text digitization may involve secure processing via certified cloud infrastructure (Microsoft Azure Document Intelligence, hosted in the Southeast Asia region) under strict confidentiality and encryption standards. A copy of our full Data Privacy Notice may be obtained from the Office of the Dean and Clinic Administrative Board of the School of Dentistry.
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
                          {resolvedScans.consentCropUrl && (
                            <button
                              type="button"
                              className="ceu-preview-zoom-btn"
                              onClick={() => setExpandedImage(resolvedScans.consentCropUrl)}
                            >
                              🔍 Zoom & Inspect
                            </button>
                          )}
                          {!readOnly && (
                            <button
                              type="button"
                              className="ceu-recrop-btn"
                              onClick={() => fileInputPage2Ref.current?.click()}
                            >
                              🔄 Re-upload / Crop
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="ceu-cropped-image-wrapper">
                        {isLoadingScans && !resolvedScans.consentCropUrl ? (
                          <div className="ceu-ocr-status-bar" role="status">
                            <span className="ceu-spinner" />
                            <span>Loading secure consent scan...</span>
                          </div>
                        ) : resolvedScans.consentCropUrl ? (
                          <img
                            src={resolvedScans.consentCropUrl}
                            alt="Cropped CEU Signed Dental Consent Form"
                            className="ceu-cropped-consent-img"
                          />
                        ) : (
                          <div className="ceu-uploaded-empty">
                            <p>Unable to load scanned consent image.</p>
                          </div>
                        )}
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
                          value={form.consentPatientName}
                          onChange={(e) => updateField("consentPatientName", e.target.value)}
                          placeholder=""
                        />
                        , of legal age, residing at{" "}
                        <input
                          type="text"
                          className="ceu-inline-line ceu-inline-line--wide"
                          value={form.consentHomeAddress}
                          onChange={(e) => updateField("consentHomeAddress", e.target.value)}
                          placeholder=""
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
                            placeholder=""
                          />
                          , the parent/legal guardian of{" "}
                          <input
                            type="text"
                            className="ceu-inline-line"
                            value={form.consentMinorPatientName}
                            onChange={(e) => updateField("consentMinorPatientName", e.target.value)}
                            placeholder=""
                          />
                          , hereby give my full consent for the dental procedures stated above.
                        </p>
                      </div>

                      <div className="ceu-consent-signatures-grid">
                        <div className="ceu-sig-block">
                          <div className="ceu-sig-line">
                            <input
                              type="text"
                              className="ceu-line-input ceu-line-input--center"
                              value={form.consentPatientName}
                              onChange={(e) => updateField("consentPatientName", e.target.value)}
                              placeholder=""
                            />
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
                            <input
                              type="text"
                              className="ceu-line-input ceu-line-input--center"
                              value={form.consentClinicianName}
                              onChange={(e) => updateField("consentClinicianName", e.target.value)}
                              placeholder=""
                            />
                          </div>
                          <span className="ceu-sig-caption">Signature over Printed Name of Clinician</span>
                          <div className="ceu-field ceu-field--sig-date">
                            <span className="ceu-label">Date:</span>
                            <input
                              type="date"
                              className="ceu-line-input"
                              value={form.consentClinicianDate || form.consentDate}
                              onChange={(e) => updateField("consentClinicianDate", e.target.value)}
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

            {/* ================= UPLOADED FORM (PAGE 1 & PAGE 2 IMAGES) ================= */}
            {activePage === "uploaded" && (
              <div className="ceu-paper-sheet ceu-paper-sheet--uploaded">
                <header className="ceu-uploaded-sheet-header">
                  <div>
                    <h3>UPLOADED ODF DOCUMENT SCANS</h3>
                    <p>
                      Patient: <strong>{form.name || "Unnamed Patient"}</strong> (ID #{form.eightDigitId})
                    </p>
                  </div>
                  <div className="ceu-uploaded-filter-group">
                    <button
                      type="button"
                      className={`ceu-switch-btn ${uploadedPageFilter === "both" ? "active" : ""}`}
                      onClick={() => setUploadedPageFilter("both")}
                    >
                      Both Pages (1 &amp; 2)
                    </button>
                    <button
                      type="button"
                      className={`ceu-switch-btn ${uploadedPageFilter === "page1" ? "active" : ""}`}
                      onClick={() => setUploadedPageFilter("page1")}
                    >
                      📄 Page 1 Image
                    </button>
                    <button
                      type="button"
                      className={`ceu-switch-btn ${uploadedPageFilter === "page2" ? "active" : ""}`}
                      onClick={() => setUploadedPageFilter("page2")}
                    >
                      📄 Page 2 Image
                    </button>
                    {!isStudent && onViewUploadedScans && (
                      <button
                        type="button"
                        className="ceu-switch-btn"
                        onClick={onViewUploadedScans}
                      >
                        🖼️ Open Full Scan Viewer
                      </button>
                    )}
                  </div>
                </header>

                <div className={`ceu-uploaded-pages-grid ${uploadedPageFilter === "both" ? "is-two-col" : ""}`}>
                  {(uploadedPageFilter === "both" || uploadedPageFilter === "page1") && (
                    <section className="ceu-uploaded-card">
                      <div className="ceu-uploaded-card__head">
                        <strong>Page 1: Oral Diagnosis Form &amp; Odontogram</strong>
                        {resolvedScans.rawScanUrl && (
                          <button
                            type="button"
                            className="ceu-preview-zoom-btn"
                            onClick={() => setExpandedImage(resolvedScans.rawScanUrl)}
                          >
                            🔍 Zoom &amp; Inspect
                          </button>
                        )}
                      </div>
                      <div className="ceu-uploaded-card__body">
                        {form.rawScanUrl ? (
                          isLoadingScans && !resolvedScans.rawScanUrl ? (
                            <div className="ceu-ocr-status-bar" role="status">
                              <span className="ceu-spinner" />
                              <span>Loading secure Page 1 scan...</span>
                            </div>
                          ) : resolvedScans.rawScanUrl ? (
                            <img
                              src={resolvedScans.rawScanUrl}
                              alt="Uploaded ODF Page 1"
                              className="ceu-uploaded-card__img"
                              onClick={() => setExpandedImage(resolvedScans.rawScanUrl)}
                            />
                          ) : (
                            <div className="ceu-uploaded-empty">
                              <span>📄</span>
                              <p>Unable to generate signed URL for Page 1 scan.</p>
                            </div>
                          )
                        ) : (
                          <div className="ceu-uploaded-empty">
                            <span>📄</span>
                            <p>No physical Page 1 scan image was uploaded for this submission.</p>
                            <button
                              type="button"
                              className="ceu-switch-btn"
                              onClick={() => setActivePage("page1")}
                            >
                              View Digital Page 1
                            </button>
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {(uploadedPageFilter === "both" || uploadedPageFilter === "page2") && (
                    <section className="ceu-uploaded-card">
                      <div className="ceu-uploaded-card__head">
                        <strong>Page 2: Diagnostic Tests, Plan &amp; Consent</strong>
                        {resolvedScans.rawScanPage2Url && (
                          <button
                            type="button"
                            className="ceu-preview-zoom-btn"
                            onClick={() => setExpandedImage(resolvedScans.rawScanPage2Url)}
                          >
                            🔍 Zoom &amp; Inspect
                          </button>
                        )}
                      </div>
                      <div className="ceu-uploaded-card__body">
                        {form.rawScanPage2Url ? (
                          isLoadingScans && !resolvedScans.rawScanPage2Url ? (
                            <div className="ceu-ocr-status-bar" role="status">
                              <span className="ceu-spinner" />
                              <span>Loading secure Page 2 scan...</span>
                            </div>
                          ) : resolvedScans.rawScanPage2Url ? (
                            <img
                              src={resolvedScans.rawScanPage2Url}
                              alt="Uploaded ODF Page 2"
                              className="ceu-uploaded-card__img"
                              onClick={() => setExpandedImage(resolvedScans.rawScanPage2Url)}
                            />
                          ) : (
                            <div className="ceu-uploaded-empty">
                              <span>📄</span>
                              <p>Unable to generate signed URL for Page 2 scan.</p>
                            </div>
                          )
                        ) : (
                          <div className="ceu-uploaded-empty">
                            <span>📄</span>
                            <p>No physical Page 2 scan image was uploaded for this submission.</p>
                            <button
                              type="button"
                              className="ceu-switch-btn"
                              onClick={() => setActivePage("page2")}
                            >
                              View Digital Page 2
                            </button>
                          </div>
                        )}
                      </div>
                    </section>
                  )}
                </div>
              </div>
            )}

            {/* Bottom Actions */}
            <div className="ceu-odf-bottom-bar">
              <button type="button" className="ceu-btn-secondary" onClick={onCancel}>
                {readOnly ? "Close" : "Cancel & Close"}
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
                {!readOnly && (
                  <button type="submit" className="ceu-btn-primary">
                    💾 Submit Oral Diagnosis Form
                  </button>
                )}
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
