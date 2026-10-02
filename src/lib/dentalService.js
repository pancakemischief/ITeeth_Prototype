import { supabase } from "./supabaseClient.js";

/**
 * Ensures patient IDs are consistently strictly 8 digits (numeric only)
 */
export function to8DigitId(id, fallbackIndex = 1) {
  if (!id) return String(10000000 + Number(fallbackIndex));
  const cleanDigits = String(id).replace(/\D/g, "");
  if (cleanDigits.length === 8) return cleanDigits;
  if (cleanDigits.length > 8) return cleanDigits.slice(0, 8);
  if (cleanDigits.length > 0) return cleanDigits.padStart(8, "0");

  // If string has letters/UUID, deterministically hash to an 8-digit number
  let hash = 0;
  const str = String(id);
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  const posHash = (Math.abs(hash) % 90000000) + 10000000;
  return String(posHash);
}

/**
 * Checks if a string is a valid UUID
 */
export function isUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str));
}

export const DEFAULT_CLINICIAN = "Dr. Jane Doe, MD";

// LocalStorage Cache Keys for resilient offline/local persistence
const CACHE_PATIENTS_KEY = "iteeth_patients_v2";
const CACHE_PENDING_KEY = "iteeth_pending_v2";
const CACHE_RECORDS_KEY = "iteeth_records_v2";

export const DEFAULT_PATIENTS = [
  {
    id: "10000001",
    eightDigitId: "10000001",
    name: "John Doe",
    lastVisit: "01/01/2026",
    clinician: DEFAULT_CLINICIAN,
    procedure: "Biannual Prophylaxis & Bitewing X-Rays",
    phone: "0917-555-0101",
    email: "patient.johndoe@gmail.com",
    gender: "Male",
    dateOfBirth: "1994-05-12",
    age: "31",
    homeAddress: "Poblacion, Makati City",
    notes: "Patient reports mild tooth sensitivity on lower left molar during cold drinks.",
  },
  {
    id: "10000002",
    eightDigitId: "10000002",
    name: "Sarah Connor",
    lastVisit: "02/14/2026",
    clinician: DEFAULT_CLINICIAN,
    procedure: "Endodontic Therapy #14",
    phone: "0918-555-0102",
    email: "sarah.connor@gmail.com",
    gender: "Female",
    dateOfBirth: "1988-11-20",
    age: "37",
    homeAddress: "San Lorenzo, Makati City",
    notes: "Completed root canal therapy on maxillary first molar. Gutta-percha obturation verified.",
  },
  {
    id: "10000003",
    eightDigitId: "10000003",
    name: "Marcus Wright",
    lastVisit: "03/10/2026",
    clinician: DEFAULT_CLINICIAN,
    procedure: "Composite Restoration #30 MOD",
    phone: "0919-555-0103",
    email: "marcus.wright@gmail.com",
    gender: "Male",
    dateOfBirth: "1991-03-15",
    age: "35",
    homeAddress: "Bel-Air, Makati City",
    notes: "Class II MOD resin restoration completed. Occlusion evaluated with articulating paper.",
  },
  {
    id: "10000004",
    eightDigitId: "10000004",
    name: "Kyle Reese",
    lastVisit: "03/18/2026",
    clinician: DEFAULT_CLINICIAN,
    procedure: "Gingival Scaling & Root Planing",
    phone: "0920-555-0104",
    email: "kyle.reese@gmail.com",
    gender: "Male",
    dateOfBirth: "1996-08-24",
    age: "29",
    homeAddress: "Palanan, Makati City",
    notes: "Full mouth scaling and root planing for localized moderate periodontitis.",
  },
];

export const DEFAULT_PENDING = [
  {
    id: "10000005",
    eightDigitId: "10000005",
    name: "Grace Brewster",
    visitDate: "03/22/2026",
    clinician: "student@ceu.edu.ph (Student Clinician)",
    submittedBy: "student@ceu.edu.ph",
    procedure: "Composite Restoration Tooth #19",
    notes: "Class II resin restoration required. Supervising faculty sign-off requested.",
    odfDetails: {
      eightDigitId: "10000005",
      name: "Grace Brewster",
      age: "27",
      sex: "Female",
      submittedBy: "student@ceu.edu.ph",
      chiefComplaints: ["Food impaction lower left quadrant", "Sensitivity to sweets"],
      historyOfPresentIllness: "Symptoms started 3 weeks ago on lower left molar with occasional discomfort during chewing.",
      bloodPressure: "115/75",
      pulseRate: "70 bpm",
      tentativeDiagnosis: ["Class II MO Dental Caries Tooth #19"],
      recommendedTreatmentPlan: ["Direct Posterior Composite Restoration #19", "Fluoride Varnish"],
    },
  },
  {
    id: "10000006",
    eightDigitId: "10000006",
    name: "Arthur Dent",
    visitDate: "03/24/2026",
    clinician: "alex.baleares@ceu.edu.ph (Student Clinician)",
    submittedBy: "alex.baleares@ceu.edu.ph",
    procedure: "Panoramic Radiograph Evaluation",
    notes: "Full mouth series review for third molar impaction.",
    odfDetails: {
      eightDigitId: "10000006",
      name: "Arthur Dent",
      age: "33",
      sex: "Male",
      submittedBy: "alex.baleares@ceu.edu.ph",
      chiefComplaints: ["Evaluation of wisdom teeth eruption", "Periodic jaw stiffness"],
      historyOfPresentIllness: "Mild pressure experienced at posterior mandibular angles bilaterally.",
      bloodPressure: "120/80",
      pulseRate: "72 bpm",
      tentativeDiagnosis: ["Mesioangular Impaction Tooth #38 and #48"],
      recommendedTreatmentPlan: ["Panoramic Radiography", "Surgical Odontectomy Consultation"],
    },
  },
];

// In-memory / LocalStorage cache helpers
let inMemoryPatients = [...DEFAULT_PATIENTS];
let inMemoryPending = [...DEFAULT_PENDING];
let inMemoryRecords = [];

export function getLocalPatients() {
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(CACHE_PATIENTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
  }
  return inMemoryPatients;
}

export function saveLocalPatients(patients) {
  inMemoryPatients = patients;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(CACHE_PATIENTS_KEY, JSON.stringify(patients));
    } catch {
      // ignore
    }
  }
}

export function getLocalPending() {
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(CACHE_PENDING_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
  }
  return inMemoryPending;
}

export function saveLocalPending(pending) {
  inMemoryPending = pending;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(CACHE_PENDING_KEY, JSON.stringify(pending));
    } catch {
      // ignore
    }
  }
}

export function getLocalRecords() {
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(CACHE_RECORDS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
  }
  return inMemoryRecords;
}

export function saveLocalRecord(record) {
  inMemoryRecords = [record, ...inMemoryRecords.filter((r) => r.id !== record.id)];
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(CACHE_RECORDS_KEY, JSON.stringify(inMemoryRecords));
    } catch {
      // ignore
    }
  }
}

/**
 * Normalizes a database row from `patients` table to standard UI patient object
 */
function normalizePatient(row, index = 1) {
  let meta = {};
  if (row.medical_history) {
    try {
      meta = typeof row.medical_history === "string" ? JSON.parse(row.medical_history) : row.medical_history;
    } catch {
      meta = { notes: row.medical_history };
    }
  }

  const fullName =
    `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
    row.name ||
    "Unknown Patient";

  const formattedDate = row.created_at
    ? new Date(row.created_at).toLocaleDateString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
      })
    : "01/01/2026";

  const eightDigitId = to8DigitId(row.eight_digit_id || meta.eightDigitId || row.id, index);

  return {
    id: eightDigitId,
    dbId: row.id,
    eightDigitId,
    name: fullName,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    email: row.email || "",
    phone: row.phone || "",
    gender: row.gender || meta.gender || "Male",
    dateOfBirth: row.date_of_birth || meta.dateOfBirth || "",
    age: meta.age || "",
    homeAddress: meta.homeAddress || "",
    lastVisit: meta.lastVisit || row.last_visit || formattedDate,
    clinician: meta.clinician || row.clinician || DEFAULT_CLINICIAN,
    procedure: meta.procedure || row.procedure || "Dental Examination & Charting",
    notes: meta.notes || (typeof row.medical_history === "string" ? row.medical_history : ""),
    odfData: meta.odfData || null,
  };
}

/**
 * Normalizes a database row from `pending_approvals` table
 */
function normalizePending(row, index = 1) {
  const odfDetails = row.odf_details || {};
  return {
    id: to8DigitId(row.id, index),
    eightDigitId: to8DigitId(row.id, index),
    name: row.name || "Unknown Patient",
    visitDate: row.visit_date || "01/01/2026",
    clinician: row.clinician || DEFAULT_CLINICIAN,
    submittedBy: row.submitted_by || odfDetails.submittedBy || null,
    clinicianEmail: row.clinician_email || odfDetails.submittedBy || null,
    procedure: row.procedure || "Oral Diagnosis Form (ODF)",
    notes: row.notes || "",
    status: row.status || "pending",
    type: "ODF Submission",
    odfDetails,
    rawScanUrl: row.raw_scan_url || odfDetails.rawScanUrl || null,
    rawScanPage2Url: row.raw_scan_page2_url || odfDetails.rawScanPage2Url || null,
    odontogramCropUrl: row.odontogram_crop_url || odfDetails.odontogramCropUrl || null,
    consentCropUrl: row.consent_crop_url || odfDetails.consentCropUrl || null,
    submittedAt: row.created_at || new Date().toISOString(),
  };
}

/**
 * Fetch patients from Supabase `patients` table, with transparent fallback & merge with local cache
 */
export async function fetchPatientsFromSupabase() {
  try {
    const { data, error } = await supabase
      .from("patients")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[Supabase] fetchPatients error:", error.message);
      return { success: false, error: error.message, data: getLocalPatients() };
    }

    if (Array.isArray(data) && data.length > 0) {
      const normalized = data.map((r, i) => normalizePatient(r, i + 1));
      // Merge with any locally added patients that aren't yet in Supabase
      const local = getLocalPatients();
      const dbIds = new Set(normalized.map((p) => p.eightDigitId));
      const missingLocal = local.filter((p) => !dbIds.has(p.eightDigitId));
      const combined = [...normalized, ...missingLocal];
      saveLocalPatients(combined);
      return { success: true, error: null, data: combined };
    }

    // If Supabase table is currently empty, return cached/default patients
    const cached = getLocalPatients();
    return { success: true, error: null, data: cached };
  } catch (err) {
    console.warn("[Supabase] Unexpected error fetching patients:", err);
    return { success: false, error: err.message, data: getLocalPatients() };
  }
}

/**
 * Fetch pending approvals from Supabase `pending_approvals` table
 */
export async function fetchPendingFromSupabase() {
  try {
    const { data, error } = await supabase
      .from("pending_approvals")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[Supabase] fetchPending error:", error.message);
      return { success: false, error: error.message, data: getLocalPending() };
    }

    if (Array.isArray(data) && data.length > 0) {
      const normalized = data.map((r, i) => normalizePending(r, i + 1));
      const local = getLocalPending();
      const dbIds = new Set(normalized.map((p) => p.id));
      const missingLocal = local.filter((p) => !dbIds.has(p.id));
      const combined = [...normalized, ...missingLocal];
      saveLocalPending(combined);
      return { success: true, error: null, data: combined };
    }

    return { success: true, error: null, data: getLocalPending() };
  } catch (err) {
    console.warn("[Supabase] Unexpected error fetching pending:", err);
    return { success: false, error: err.message, data: getLocalPending() };
  }
}

/**
 * Save or update a patient in Supabase and local cache
 */
export async function savePatientToSupabase(patient) {
  const numericId = to8DigitId(patient.id || patient.eightDigitId);
  const nameParts = (patient.name || "").trim().split(/\s+/);
  const firstName = patient.firstName || nameParts[0] || "Unnamed";
  const lastName = patient.lastName || nameParts.slice(1).join(" ") || "Patient";

  const meta = {
    eightDigitId: numericId,
    clinician: patient.clinician || DEFAULT_CLINICIAN,
    lastVisit:
      patient.lastVisit ||
      new Date().toLocaleDateString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
      }),
    procedure: patient.procedure || "Dental Examination & Charting",
    notes: patient.notes || "",
    phone: patient.phone || "",
    email: patient.email || "",
    gender: patient.gender || "Male",
    dateOfBirth: patient.dateOfBirth || "",
    age: patient.age || "",
    homeAddress: patient.homeAddress || "",
    odfData: patient.odfData || null,
  };

  const formattedPatient = {
    id: numericId,
    eightDigitId: numericId,
    name: `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    email: patient.email || null,
    phone: patient.phone || null,
    gender: patient.gender || "Male",
    dateOfBirth: patient.dateOfBirth || null,
    age: patient.age || "",
    homeAddress: patient.homeAddress || "",
    lastVisit: meta.lastVisit,
    clinician: meta.clinician,
    procedure: meta.procedure,
    notes: meta.notes,
    odfData: patient.odfData || null,
    dbId: patient.dbId || null,
  };

  // Always update local storage immediately
  const localList = getLocalPatients();
  const updatedLocal = [
    formattedPatient,
    ...localList.filter((p) => to8DigitId(p.id) !== numericId),
  ];
  saveLocalPatients(updatedLocal);

  try {
    const payload = {
      eight_digit_id: numericId,
      first_name: firstName,
      last_name: lastName,
      email: patient.email || null,
      phone: patient.phone || null,
      gender: patient.gender || null,
      date_of_birth: patient.dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(patient.dateOfBirth) ? patient.dateOfBirth : null,
      medical_history: JSON.stringify(meta),
      updated_at: new Date().toISOString(),
    };

    if (patient.dbId && isUuid(patient.dbId)) {
      payload.id = patient.dbId;
      const { data, error } = await supabase
        .from("patients")
        .upsert(payload, { onConflict: "id" })
        .select();

      if (error) {
        console.warn("[Supabase] savePatient upsert error:", error.message);
        return { success: false, error: error.message, data: formattedPatient };
      }
      return { success: true, data: data?.[0] ? normalizePatient(data[0]) : formattedPatient };
    } else {
      // Check if already in Supabase by eight_digit_id
      const { data: existing } = await supabase
        .from("patients")
        .select("id")
        .eq("eight_digit_id", numericId)
        .maybeSingle();

      if (existing?.id) {
        const { data, error } = await supabase
          .from("patients")
          .update(payload)
          .eq("id", existing.id)
          .select();
        if (error) {
          console.warn("[Supabase] update existing patient error:", error.message);
          return { success: false, error: error.message, data: formattedPatient };
        }
        return { success: true, data: data?.[0] ? normalizePatient(data[0]) : formattedPatient };
      } else {
        const { data, error } = await supabase
          .from("patients")
          .insert(payload)
          .select();
        if (error) {
          console.warn("[Supabase] insert patient error:", error.message);
          return { success: false, error: error.message, data: formattedPatient };
        }
        return { success: true, data: data?.[0] ? normalizePatient(data[0]) : formattedPatient };
      }
    }
  } catch (err) {
    console.warn("[Supabase] Unexpected error saving patient:", err);
    return { success: false, error: err.message, data: formattedPatient };
  }
}

/**
 * Upload cropped or scanned ODF image to Supabase Storage bucket 'odf-scans'
 */
export async function uploadOdfImageToStorage(fileOrBlob, fileName) {
  if (!fileOrBlob) return null;
  try {
    const cleanFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await supabase.storage
      .from("odf-scans")
      .upload(cleanFileName, fileOrBlob, {
        cacheControl: "3600",
        upsert: true,
      });

    if (error) {
      console.warn("[Supabase Storage] Notice:", error.message);
      if (fileOrBlob instanceof Blob) {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(fileOrBlob);
        });
      }
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from("odf-scans")
      .getPublicUrl(cleanFileName);

    return publicUrlData?.publicUrl || cleanFileName;
  } catch (err) {
    console.warn("[Supabase Storage] Unexpected upload error:", err);
    if (fileOrBlob instanceof Blob) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(fileOrBlob);
      });
    }
    return null;
  }
}

/**
 * Submit an Oral Diagnosis Form (ODF) or pending approval
 * Conforms strictly to schema in pending_approvals:
 * columns: id (text), name (text), visit_date (text), clinician (text), procedure (text), notes (text), status (text), odf_details (jsonb)
 */
export async function savePendingToSupabase(item) {
  const numericId = to8DigitId(item.id || item.eightDigitId);

  // Preserve image crops inside odf_details
  const odfDetails = {
    ...(item.odfDetails || item),
    odontogramCropUrl: item.odontogramCropUrl || item.odfDetails?.odontogramCropUrl || null,
    consentCropUrl: item.consentCropUrl || item.odfDetails?.consentCropUrl || null,
    eightDigitId: numericId,
  };

  const formattedPending = {
    id: numericId,
    eightDigitId: numericId,
    name: item.name || "Unnamed Patient",
    visitDate:
      item.visitDate ||
      new Date().toLocaleDateString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
      }),
    clinician: item.clinician || DEFAULT_CLINICIAN,
    procedure: item.procedure || "Oral Diagnosis Form (ODF)",
    notes: item.notes || item.historyOfPresentIllness || "",
    status: item.status || "pending",
    type: "ODF Submission",
    odfDetails,
    odontogramCropUrl: odfDetails.odontogramCropUrl,
    consentCropUrl: odfDetails.consentCropUrl,
    submittedAt: new Date().toISOString(),
  };

  // 1. Immediately update LocalStorage cache so data is NEVER lost on restart
  const localPending = getLocalPending();
  const updatedPending = [
    formattedPending,
    ...localPending.filter((p) => to8DigitId(p.id) !== numericId),
  ];
  saveLocalPending(updatedPending);

  // 2. Also register or update patient in patients cache so the patient appears in records
  const localPatients = getLocalPatients();
  const existingPatient = localPatients.find((p) => to8DigitId(p.id) === numericId);
  if (!existingPatient) {
    const newPatient = {
      id: numericId,
      eightDigitId: numericId,
      name: formattedPending.name,
      lastVisit: formattedPending.visitDate,
      clinician: formattedPending.clinician,
      procedure: formattedPending.procedure,
      notes: formattedPending.notes,
      phone: odfDetails.cellPhone || odfDetails.homeTel || "",
      gender: odfDetails.sex || "Male",
      dateOfBirth: odfDetails.birthDate || "",
      age: odfDetails.age || "",
      homeAddress: odfDetails.homeAddress || "",
      odfData: odfDetails,
    };
    savePatientToSupabase(newPatient).catch(() => {});
  }

  // 3. Attempt insert to Supabase pending_approvals table
  try {
    const payload = {
      id: numericId,
      name: formattedPending.name,
      visit_date: formattedPending.visitDate,
      clinician: formattedPending.clinician,
      submitted_by: formattedPending.submittedBy || odfDetails.submittedBy || null,
      procedure: formattedPending.procedure,
      notes: formattedPending.notes,
      status: "pending",
      raw_scan_url: formattedPending.rawScanUrl || odfDetails.rawScanUrl || null,
      raw_scan_page2_url: formattedPending.rawScanPage2Url || odfDetails.rawScanPage2Url || null,
      odontogram_crop_url: formattedPending.odontogramCropUrl || odfDetails.odontogramCropUrl || null,
      consent_crop_url: formattedPending.consentCropUrl || odfDetails.consentCropUrl || null,
      odf_details: odfDetails,
    };

    const { data, error } = await supabase
      .from("pending_approvals")
      .upsert(payload, { onConflict: "id" })
      .select();

    if (error) {
      console.warn("[Supabase] savePending error:", error.message);
      return { success: false, error: error.message, data: formattedPending };
    }

    return {
      success: true,
      error: null,
      data: data?.[0] ? normalizePending(data[0]) : formattedPending,
    };
  } catch (err) {
    console.warn("[Supabase] Unexpected error saving pending approval:", err);
    return { success: false, error: err.message, data: formattedPending };
  }
}

/**
 * Approve a pending ODF request: updates pending_approvals and adds treatment record
 */
export async function approvePendingInSupabase(item) {
  const numericId = to8DigitId(item.id);

  // 1. Update local pending cache
  const localPending = getLocalPending();
  saveLocalPending(localPending.filter((p) => to8DigitId(p.id) !== numericId));

  // 2. Add to treatment records
  const treatmentRecord = {
    id: `rec_${Date.now()}`,
    patientId: numericId,
    title: item.procedure || "Approved Oral Diagnosis Form (ODF)",
    date: item.visitDate || new Date().toLocaleDateString("en-US"),
    clinician: item.clinician || DEFAULT_CLINICIAN,
    type: "odf",
    typeLabel: "Approved ODF",
    status: "Faculty Approved",
    notes: item.notes || "Approved faculty procedure and ODF documentation.",
    rawScanUrl: item.rawScanUrl || item.odfDetails?.rawScanUrl || null,
    rawScanPage2Url: item.rawScanPage2Url || item.odfDetails?.rawScanPage2Url || null,
    odfDetails: item.odfDetails || null,
    odontogramCropUrl: item.odfDetails?.odontogramCropUrl || item.odontogramCropUrl || null,
    consentCropUrl: item.odfDetails?.consentCropUrl || item.consentCropUrl || null,
  };
  saveLocalRecord(treatmentRecord);

  // 3. Update patient record
  const patientResult = await savePatientToSupabase({
    id: numericId,
    name: item.name,
    lastVisit: item.visitDate,
    clinician: item.clinician || DEFAULT_CLINICIAN,
    procedure: item.procedure || "Approved Oral Diagnosis Form (ODF)",
    notes: item.notes || "Approved faculty procedure and ODF documentation.",
    latestOdfScanUrl: item.rawScanUrl || item.odfDetails?.rawScanUrl || null,
    latestOdfPage2Url: item.rawScanPage2Url || item.odfDetails?.rawScanPage2Url || null,
    odfData: item.odfDetails || null,
  });

  // 4. Update Supabase
  try {
    await supabase
      .from("pending_approvals")
      .update({ status: "approved" })
      .eq("id", numericId);

    // Also insert into treatment_records in Supabase if patient has a dbId UUID
    if (patientResult.data?.dbId && isUuid(patientResult.data.dbId)) {
      await supabase.from("treatment_records").insert({
        patient_id: patientResult.data.dbId,
        procedure_name: item.procedure || "Approved ODF",
        diagnosis: item.procedure,
        notes: item.notes,
        treatment_date: new Date().toISOString().split("T")[0],
        cost: 0,
      });
    }

    return { success: true, data: patientResult.data };
  } catch (err) {
    console.warn("[Supabase] Unexpected error approving pending item:", err);
    return { success: true, data: patientResult.data };
  }
}

/**
 * Decline a pending ODF request
 */
export async function declinePendingInSupabase(item) {
  const numericId = to8DigitId(item.id);

  // Update local pending cache
  const localPending = getLocalPending();
  saveLocalPending(localPending.filter((p) => to8DigitId(p.id) !== numericId));

  try {
    const { error } = await supabase
      .from("pending_approvals")
      .update({ status: "declined" })
      .eq("id", numericId);

    if (error) {
      console.warn("[Supabase] declinePending error:", error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    console.warn("[Supabase] Unexpected error declining pending item:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Fetches all historical records for a specific patient:
 * Combines treatment_records, pending_approvals, appointments, and local consultations
 */
export async function fetchPatientHistoryRecords(patient) {
  if (!patient) return [];
  const numericId = to8DigitId(patient.id || patient.eightDigitId);

  // Baseline records tailored to patient ID
  const baselineMap = {
    "10000001": [
      {
        id: "rec_1001_1",
        date: "10/01/2026",
        dateFormatted: { month: "OCT", day: "01", year: "2026" },
        title: "Oral Diagnosis Form (ODF) Examination",
        type: "odf",
        typeLabel: "ODF Form",
        status: "Verified & Approved",
        toothNo: "#19",
        clinician: DEFAULT_CLINICIAN,
        summary: "Comprehensive clinical charting, bitewing analysis, and Class II restorative evaluation.",
        notes: "Tooth #19 exhibits occlusal-distal carious lesion. Pulp vitality test within normal limits.",
        hasOdontogram: true,
        odfDetails: {
          eightDigitId: "10000001",
          name: "John Doe",
          age: "31",
          sex: "Male",
          chiefComplaints: ["Tooth sensitivity on lower left molar during cold drinks", "Routine 6-month checkup"],
          historyOfPresentIllness: "Patient noted mild discomfort when drinking cold fluids for approximately two weeks.",
          bloodPressure: "120/80",
          pulseRate: "72 bpm",
          respiratoryRate: "16 cpm",
          temperature: "36.5 °C",
          tentativeDiagnosis: ["Class II Occlusal-Distal Dental Caries Tooth #19"],
          recommendedTreatmentPlan: ["Direct posterior composite restoration #19", "Biannual prophylaxis & topical fluoride"],
        },
      },
      {
        id: "rec_1001_2",
        date: "06/14/2026",
        dateFormatted: { month: "JUN", day: "14", year: "2026" },
        title: "Composite Restoration Tooth #30 MOD",
        type: "treatment",
        typeLabel: "Treatment Record",
        status: "Completed",
        toothNo: "#30",
        clinician: DEFAULT_CLINICIAN,
        diagnosis: "Class II MOD Dental Caries",
        summary: "Cavity preparation under local infiltration anesthesia. Etched, bonded, and cured with nanohybrid composite.",
        notes: "Articulating paper verification confirmed harmonious centric contact. Patient instructed on post-op care.",
      },
      {
        id: "rec_1001_3",
        date: "01/01/2026",
        dateFormatted: { month: "JAN", day: "01", year: "2026" },
        title: "Biannual Prophylaxis & Bitewing Radiographs",
        type: "treatment",
        typeLabel: "Prophylaxis",
        status: "Completed",
        clinician: DEFAULT_CLINICIAN,
        diagnosis: "Mild plaque-induced gingivitis",
        summary: "Ultrasonic scaling and polishing with fine fluoride paste. Radiographs reveal bone levels intact.",
        notes: "Demonstrated modified Bass brushing technique and daily interdental flossing.",
      },
      {
        id: "rec_1001_4",
        date: "08/15/2025",
        dateFormatted: { month: "AUG", day: "15", year: "2025" },
        title: "Initial Comprehensive Dental Consultation",
        type: "appointment",
        typeLabel: "Consultation",
        status: "Completed",
        clinician: DEFAULT_CLINICIAN,
        summary: "Establishment of patient dental record, medical questionnaire completion, and soft tissue examination.",
        notes: "No systemic contraindications to elective dental care noted.",
      },
    ],
    "10000002": [
      {
        id: "rec_1002_1",
        date: "02/14/2026",
        dateFormatted: { month: "FEB", day: "14", year: "2026" },
        title: "Endodontic Therapy #14 (Root Canal)",
        type: "treatment",
        typeLabel: "Treatment Record",
        status: "Completed",
        toothNo: "#14",
        clinician: DEFAULT_CLINICIAN,
        diagnosis: "Symptomatic Irreversible Pulpitis #14",
        summary: "Biomechanically prepared MB, DB, and palatal canals. Obturated with gutta-percha and AH Plus sealer.",
        notes: "Post-endodontic core buildup completed. Scheduled for full ceramic crown fabrication.",
      },
      {
        id: "rec_1002_2",
        date: "11/20/2025",
        dateFormatted: { month: "NOV", day: "20", year: "2025" },
        title: "Oral Diagnosis Form (ODF) — Pulp Vitality Assessment",
        type: "odf",
        typeLabel: "ODF Form",
        status: "Verified & Approved",
        toothNo: "#14",
        clinician: DEFAULT_CLINICIAN,
        summary: "Diagnostic cold test elicited lingering pain on tooth #14. Periapical radiograph indicates widening of PDL.",
        notes: "Recommended root canal treatment followed by cusp-coverage restoration.",
      },
    ],
    "10000003": [
      {
        id: "rec_1003_1",
        date: "03/10/2026",
        dateFormatted: { month: "MAR", day: "10", year: "2026" },
        title: "Composite Restoration #30 MOD",
        type: "treatment",
        typeLabel: "Treatment Record",
        status: "Completed",
        toothNo: "#30",
        clinician: DEFAULT_CLINICIAN,
        diagnosis: "Moderate dentin caries",
        summary: "Composite placed in 2mm increments. Finishing completed with composite polishing discs.",
        notes: "Centric and eccentric occlusal contacts checked and cleared.",
      },
    ],
    "10000004": [
      {
        id: "rec_1004_1",
        date: "03/18/2026",
        dateFormatted: { month: "MAR", day: "18", year: "2026" },
        title: "Gingival Scaling & Root Planing (Quad 1 & 2)",
        type: "treatment",
        typeLabel: "Periodontics",
        status: "Completed",
        clinician: DEFAULT_CLINICIAN,
        diagnosis: "Localized Stage II Periodontitis",
        summary: "Subgingival debridement performed with Gracey curettes 1/2 and 11/12 under topical lidocaine.",
        notes: "Follow-up periodontal probing scheduled in 4 weeks.",
      },
    ],
  };

  const recordsList = [...(baselineMap[numericId] || [])];

  // Also include any ODF data stored on the patient object itself
  if (patient.odfData) {
    const odf = patient.odfData;
    const hasAlready = recordsList.some((r) => r.type === "odf" && r.title.includes("ODF"));
    if (!hasAlready) {
      recordsList.unshift({
        id: `odf_${numericId}_current`,
        date: patient.lastVisit || new Date().toLocaleDateString("en-US"),
        dateFormatted: formatDateParts(patient.lastVisit),
        title: "Oral Diagnosis Form (ODF) Submission",
        type: "odf",
        typeLabel: "ODF Form",
        status: "Clinical Record",
        clinician: patient.clinician || DEFAULT_CLINICIAN,
        summary: patient.procedure || "Clinical oral diagnosis and examination",
        notes: patient.notes || odf.historyOfPresentIllness || "",
        hasOdontogram: !!(odf.odontogramCropUrl || patient.odfData?.odontogramCropUrl),
        odontogramCropUrl: odf.odontogramCropUrl,
        consentCropUrl: odf.consentCropUrl,
        odfDetails: odf,
      });
    }
  }

  // Also query Supabase treatment_records and pending_approvals if possible
  try {
    // 1. Treatment records by patient_id
    if (patient.dbId && isUuid(patient.dbId)) {
      const { data: treatments } = await supabase
        .from("treatment_records")
        .select("*")
        .eq("patient_id", patient.dbId)
        .order("treatment_date", { ascending: false });

      if (Array.isArray(treatments)) {
        treatments.forEach((t) => {
          recordsList.unshift({
            id: `tr_${t.id}`,
            date: t.treatment_date || new Date(t.created_at).toLocaleDateString("en-US"),
            dateFormatted: formatDateParts(t.treatment_date || t.created_at),
            title: t.procedure_name || "Dental Treatment",
            type: "treatment",
            typeLabel: "Treatment Record",
            status: "Recorded in DB",
            toothNo: t.tooth_number ? `Tooth #${t.tooth_number}` : null,
            clinician: patient.clinician || DEFAULT_CLINICIAN,
            diagnosis: t.diagnosis || "",
            summary: t.notes || t.procedure_name,
            notes: t.notes,
          });
        });
      }
    }

    // 2. Pending or approved approvals for this patient
    const { data: approvals } = await supabase
      .from("pending_approvals")
      .select("*")
      .eq("id", numericId);

    if (Array.isArray(approvals)) {
      approvals.forEach((appr) => {
        const details = appr.odf_details || {};
        recordsList.unshift({
          id: `appr_${appr.id}_${appr.created_at || Date.now()}`,
          date: appr.visit_date || "01/01/2026",
          dateFormatted: formatDateParts(appr.visit_date),
          title: appr.procedure || "Oral Diagnosis Form (ODF)",
          type: "odf",
          typeLabel: appr.status === "approved" ? "Approved ODF" : "Pending ODF",
          status: appr.status === "approved" ? "Faculty Approved" : "Pending Sign-off",
          clinician: appr.clinician || DEFAULT_CLINICIAN,
          summary: appr.notes || details.historyOfPresentIllness || "ODF Clinical Consultation",
          notes: appr.notes,
          hasOdontogram: !!(details.odontogramCropUrl || appr.odontogram_crop_url),
          rawScanUrl: appr.raw_scan_url || details.rawScanUrl || null,
          rawScanPage2Url: appr.raw_scan_page2_url || details.rawScanPage2Url || null,
          odontogramCropUrl: details.odontogramCropUrl || appr.odontogram_crop_url || null,
          consentCropUrl: details.consentCropUrl || appr.consent_crop_url || null,
          odfDetails: details,
        });
      });
    }
  } catch (err) {
    console.warn("Could not query external history records:", err);
  }

  // Also include any locally saved records for this patient
  const localRecs = getLocalRecords().filter((r) => r.patientId === numericId);
  localRecs.forEach((lr) => {
    recordsList.unshift({
      ...lr,
      dateFormatted: formatDateParts(lr.date),
    });
  });

  // Deduplicate by ID
  const seen = new Set();
  const deduped = [];
  for (const r of recordsList) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      deduped.push({
        ...r,
        dateFormatted: r.dateFormatted || formatDateParts(r.date),
      });
    }
  }

  // If list is empty for a newly added patient, supply a default baseline initial exam record
  if (deduped.length === 0) {
    deduped.push({
      id: `init_${numericId}`,
      date: patient.lastVisit || new Date().toLocaleDateString("en-US"),
      dateFormatted: formatDateParts(patient.lastVisit),
      title: patient.procedure || "Initial Clinical Consultation & Oral Examination",
      type: "treatment",
      typeLabel: "Clinical Entry",
      status: "Verified",
      clinician: patient.clinician || DEFAULT_CLINICIAN,
      summary: patient.notes || "Patient clinical chart opened and documented in CEU Dental System.",
      notes: patient.notes,
    });
  }

  return deduped;
}

function formatDateParts(dateStr) {
  if (!dateStr) return { month: "DATE", day: "01", year: "2026" };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    const parts = String(dateStr).split(/[/.-]/);
    if (parts.length >= 3) {
      const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
      const mIdx = Math.max(0, Math.min(11, parseInt(parts[0], 10) - 1));
      return { month: monthNames[mIdx] || "DATE", day: parts[1], year: parts[2] };
    }
    return { month: "DATE", day: String(dateStr), year: "" };
  }
  return {
    month: d.toLocaleString("en-US", { month: "short" }).toUpperCase(),
    day: d.toLocaleString("en-US", { day: "2-digit" }),
    year: d.getFullYear(),
  };
}

/**
 * Updates a record or patient document scan in local cache and Supabase
 */
export async function updateRecordDocumentScan({ recordId, patientId, type, url }) {
  const numericId = to8DigitId(patientId);
  const localRecs = getLocalRecords();
  const updatedRecs = localRecs.map((r) => {
    if (r.id === recordId || r.patientId === numericId) {
      if (type === "page1") return { ...r, rawScanUrl: url, page1ScanUrl: url };
      if (type === "page2") return { ...r, rawScanPage2Url: url, page2ScanUrl: url };
      if (type === "odontogram") return { ...r, odontogramCropUrl: url };
      if (type === "consent") return { ...r, consentCropUrl: url };
    }
    return r;
  });
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(CACHE_RECORDS_KEY, JSON.stringify(updatedRecs));
    } catch {
      // ignore
    }
  }

  // Also update patient in local storage
  const localPatients = getLocalPatients();
  const updatedPatients = localPatients.map((p) => {
    if (to8DigitId(p.id) === numericId) {
      const odf = p.odfData || {};
      const updatedOdf = {
        ...odf,
        ...(type === "page1" ? { rawScanUrl: url, page1ScanUrl: url } : {}),
        ...(type === "page2" ? { rawScanPage2Url: url, page2ScanUrl: url } : {}),
        ...(type === "odontogram" ? { odontogramCropUrl: url } : {}),
        ...(type === "consent" ? { consentCropUrl: url } : {}),
      };
      return {
        ...p,
        latestOdfScanUrl: type === "page1" ? url : p.latestOdfScanUrl,
        latestOdfPage2Url: type === "page2" ? url : p.latestOdfPage2Url,
        odfData: updatedOdf,
      };
    }
    return p;
  });
  saveLocalPatients(updatedPatients);

  // Sync to Supabase if reachable
  try {
    if (type === "page1") {
      await supabase.from("patients").update({ latest_odf_scan_url: url }).eq("eight_digit_id", numericId);
    } else if (type === "page2") {
      await supabase.from("patients").update({ latest_odf_page2_url: url }).eq("eight_digit_id", numericId);
    }
  } catch (err) {
    console.warn("Could not sync document scan to Supabase:", err);
  }
}

/**
 * Test Supabase connection
 */
export async function testSupabaseConnection() {
  try {
    const { error } = await supabase.from("patients").select("id").limit(1);
    if (error) {
      return { connected: true, tableFound: false, error: error.message };
    }
    return { connected: true, tableFound: true, error: null };
  } catch (err) {
    return { connected: false, tableFound: false, error: err.message };
  }
}
