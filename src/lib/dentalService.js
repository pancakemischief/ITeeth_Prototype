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

function sanitizeSupabaseError(error, fallback = "Unable to sync with cloud database.") {
  const raw = typeof error === "string" ? error : error?.message || "";
  const lower = raw.toLowerCase();
  if (
    !raw ||
    lower.includes("row-level security") ||
    lower.includes("rls") ||
    lower.includes("policy") ||
    lower.includes("permission denied") ||
    lower.includes("jwt") ||
    lower.includes("postgres")
  ) {
    return fallback;
  }
  return raw;
}

export const DEFAULT_CLINICIAN = "Dr. Jane Doe, MD";

// LocalStorage Cache Keys for resilient offline/local persistence
const CACHE_PATIENTS_KEY = "iteeth_patients_v2";
const CACHE_PENDING_KEY = "iteeth_pending_v2";
const CACHE_RECORDS_KEY = "iteeth_records_v2";
const CACHE_DELETED_PATIENTS_KEY = "iteeth_deleted_patients_v2";
const CACHE_DELETED_RECORDS_KEY = "iteeth_deleted_records_v2";

/**
 * Normalizes a person's name into comparable tokens, handling both
 * "First Last" and "Last, First M.I." formats.
 */
export function extractComparableNameTokens(name) {
  if (!name || typeof name !== "string") return [];
  const raw = name.trim();
  if (!raw) return [];

  // Reorder "Last, First Middle" -> "First Middle Last"
  let reordered = raw;
  if (raw.includes(",")) {
    const [lastPart, ...restParts] = raw.split(",");
    const firstMiddle = restParts.join(" ").trim();
    const last = lastPart.trim();
    reordered = `${firstMiddle} ${last}`.trim();
  }

  return reordered
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Matches a patient name against existing patients in the database/records.
 * Supports exact match, comma-separated "Last, First M.I.", and ignoring middle initials.
 */
export function findExistingPatientByName(name, patientsList = []) {
  const inputTokens = extractComparableNameTokens(name);
  if (inputTokens.length === 0) return null;

  const normalizedInput = inputTokens.join(" ");
  if (
    normalizedInput === "unnamed patient" ||
    normalizedInput === "unknown patient" ||
    normalizedInput.length < 3
  ) {
    return null;
  }

  // Strip 1-letter middle initials when comparing multi-word names
  const coreInputTokens =
    inputTokens.length >= 3
      ? inputTokens.filter((t, idx) => idx === 0 || idx === inputTokens.length - 1 || t.length > 1)
      : inputTokens;
  const sortedCoreInput = [...coreInputTokens].sort().join(" ");

  for (const patient of patientsList || []) {
    if (!patient?.name) continue;
    const targetTokens = extractComparableNameTokens(patient.name);
    if (targetTokens.length === 0) continue;

    // Exact normalized token sequence match
    if (targetTokens.join(" ") === normalizedInput) {
      return patient;
    }

    // Core token match (handles "Doe, John" vs "John Doe" and "Doe, John M." vs "John Doe")
    if (coreInputTokens.length >= 2 && targetTokens.length >= 2) {
      const coreTargetTokens =
        targetTokens.length >= 3
          ? targetTokens.filter((t, idx) => idx === 0 || idx === targetTokens.length - 1 || t.length > 1)
          : targetTokens;

      if (
        coreInputTokens.length === coreTargetTokens.length &&
        [...coreTargetTokens].sort().join(" ") === sortedCoreInput
      ) {
        return patient;
      }
    }
  }

  return null;
}

/**
 * Generates the next unique unused 8-digit patient ID starting from 10000001.
 */
export function generateNextPatientId(patientsList = [], pendingList = []) {
  const all = [...(patientsList || []), ...(pendingList || []), ...DEFAULT_PATIENTS, ...DEFAULT_PENDING];
  let maxNumeric = 10000000;
  const used = new Set();

  for (const item of all) {
    const idStr = to8DigitId(item?.eightDigitId || item?.id);
    used.add(idStr);
    const num = parseInt(idStr, 10);
    if (!Number.isNaN(num) && num >= 10000000 && num < 99999999) {
      if (num > maxNumeric) maxNumeric = num;
    }
  }

  let candidate = maxNumeric + 1;
  while (used.has(String(candidate).padStart(8, "0"))) {
    candidate += 1;
  }
  return String(candidate).padStart(8, "0");
}

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
    dateOfBirth: "05/12/1994",
    age: "31",
    homeAddress: "Poblacion, Makati City",
    notes: "Patient reports mild tooth sensitivity on lower left molar during cold drinks.",
    odfData: {
      eightDigitId: "10000001",
      name: "John Doe",
      birthDate: "05/12/1994",
      age: "31",
      sex: "Male",
      height: "173 cm",
      weight: "68 kg",
      civilStatus: "Single",
      homeTel: "(02) 8555-0101",
      cellPhone: "0917-555-0101",
      nationality: "Filipino",
      occupation: "Software Analyst",
      religion: "Roman Catholic",
      homeAddress: "Poblacion, Makati City",
      allergyCheck: "present",
      allergySpecify: "Mild sensitivity to Penicillin",
    },
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
    dateOfBirth: "11/20/1988",
    age: "37",
    homeAddress: "San Lorenzo, Makati City",
    notes: "Completed root canal therapy on maxillary first molar. Gutta-percha obturation verified.",
    odfData: {
      eightDigitId: "10000002",
      name: "Sarah Connor",
      birthDate: "11/20/1988",
      age: "37",
      sex: "Female",
      height: "165 cm",
      weight: "58 kg",
      civilStatus: "Married",
      homeTel: "(02) 8555-0102",
      cellPhone: "0918-555-0102",
      nationality: "Filipino",
      occupation: "Accountant",
      religion: "Christian",
      homeAddress: "San Lorenzo, Makati City",
      allergyCheck: "none",
      allergySpecify: "",
    },
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
    dateOfBirth: "03/15/1991",
    age: "35",
    homeAddress: "Bel-Air, Makati City",
    notes: "Class II MOD resin restoration completed. Occlusion evaluated with articulating paper.",
    odfData: {
      eightDigitId: "10000003",
      name: "Marcus Wright",
      birthDate: "03/15/1991",
      age: "35",
      sex: "Male",
      height: "178 cm",
      weight: "74 kg",
      civilStatus: "Single",
      homeTel: "—",
      cellPhone: "0919-555-0103",
      nationality: "Filipino",
      occupation: "Architect",
      religion: "Roman Catholic",
      homeAddress: "Bel-Air, Makati City",
      allergyCheck: "none",
      allergySpecify: "",
    },
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
    dateOfBirth: "08/24/1996",
    age: "29",
    homeAddress: "Palanan, Makati City",
    notes: "Full mouth scaling and root planing for localized moderate periodontitis.",
    odfData: {
      eightDigitId: "10000004",
      name: "Kyle Reese",
      birthDate: "08/24/1996",
      age: "29",
      sex: "Male",
      height: "170 cm",
      weight: "65 kg",
      civilStatus: "Single",
      homeTel: "—",
      cellPhone: "0920-555-0104",
      nationality: "Filipino",
      occupation: "Technician",
      religion: "Roman Catholic",
      homeAddress: "Palanan, Makati City",
      allergyCheck: "none",
      allergySpecify: "",
    },
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
let inMemoryDeletedPatientIds = [];
let inMemoryDeletedRecordIds = [];

export function getDeletedPatientIds() {
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(CACHE_DELETED_PATIENTS_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          inMemoryDeletedPatientIds = parsed;
          return parsed;
        }
      }
    } catch {
      // ignore
    }
  }
  return inMemoryDeletedPatientIds;
}

function addDeletedPatientIds(ids = []) {
  const next = Array.from(new Set([...getDeletedPatientIds(), ...ids.map((id) => to8DigitId(id))]));
  inMemoryDeletedPatientIds = next;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(CACHE_DELETED_PATIENTS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return next;
}

export function getDeletedRecordIds() {
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(CACHE_DELETED_RECORDS_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          inMemoryDeletedRecordIds = parsed;
          return parsed;
        }
      }
    } catch {
      // ignore
    }
  }
  return inMemoryDeletedRecordIds;
}

function addDeletedRecordIds(ids = []) {
  const next = Array.from(new Set([...getDeletedRecordIds(), ...ids.filter(Boolean).map(String)]));
  inMemoryDeletedRecordIds = next;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(CACHE_DELETED_RECORDS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return next;
}

export function getLocalPatients() {
  const deletedSet = new Set(getDeletedPatientIds());
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(CACHE_PATIENTS_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((p) => !deletedSet.has(to8DigitId(p?.eightDigitId || p?.id)));
        }
      }
    } catch {
      // ignore
    }
  }
  return inMemoryPatients.filter((p) => !deletedSet.has(to8DigitId(p?.eightDigitId || p?.id)));
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
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
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
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
  }
  return inMemoryRecords;
}

export function saveLocalRecord(record) {
  inMemoryRecords = [record, ...getLocalRecords().filter((r) => r.id !== record.id)];
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(CACHE_RECORDS_KEY, JSON.stringify(inMemoryRecords));
    } catch {
      // ignore
    }
  }
}

function saveLocalRecordsList(records) {
  inMemoryRecords = records;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(CACHE_RECORDS_KEY, JSON.stringify(records));
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
  const eightDigitId = to8DigitId(
    row.eight_digit_id || odfDetails.eightDigitId || row.id,
    index,
  );
  return {
    id: eightDigitId,
    dbId: row.id,
    submissionId: String(row.id),
    eightDigitId,
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
 * Fetch patients from Supabase `patients` table
 */
export async function fetchPatientsFromSupabase() {
  const deletedSet = new Set(getDeletedPatientIds());
  try {
    const { data, error } = await supabase
      .from("patients")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[Supabase] fetchPatients error:", error.message);
      return {
        success: false,
        error: sanitizeSupabaseError(error, "Using cached patient records."),
        data: getLocalPatients(),
      };
    }

    const normalized = (Array.isArray(data) ? data : [])
      .map((r, i) => normalizePatient(r, i + 1))
      .filter((p) => !deletedSet.has(p.eightDigitId));
    saveLocalPatients(normalized);
    return { success: true, error: null, data: normalized };
  } catch (err) {
    console.warn("[Supabase] Unexpected error fetching patients:", err);
    return {
      success: false,
      error: sanitizeSupabaseError(err, "Using cached patient records."),
      data: getLocalPatients(),
    };
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
      return {
        success: false,
        error: sanitizeSupabaseError(error, "Using cached submissions."),
        data: getLocalPending(),
      };
    }

    const normalized = (Array.isArray(data) ? data : []).map((r, i) =>
      normalizePending(r, i + 1)
    );
    saveLocalPending(normalized);
    return { success: true, error: null, data: normalized };
  } catch (err) {
    console.warn("[Supabase] Unexpected error fetching pending:", err);
    return {
      success: false,
      error: sanitizeSupabaseError(err, "Using cached submissions."),
      data: getLocalPending(),
    };
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
        return {
          success: false,
          error: sanitizeSupabaseError(error, "Saved locally."),
          data: formattedPatient,
        };
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
          return {
            success: false,
            error: sanitizeSupabaseError(error, "Saved locally."),
            data: formattedPatient,
          };
        }
        return { success: true, data: data?.[0] ? normalizePatient(data[0]) : formattedPatient };
      } else {
        const { data, error } = await supabase
          .from("patients")
          .insert(payload)
          .select();
        if (error) {
          console.warn("[Supabase] insert patient error:", error.message);
          return {
            success: false,
            error: sanitizeSupabaseError(error, "Saved locally."),
            data: formattedPatient,
          };
        }
        return { success: true, data: data?.[0] ? normalizePatient(data[0]) : formattedPatient };
      }
    }
  } catch (err) {
    console.warn("[Supabase] Unexpected error saving patient:", err);
    return {
      success: false,
      error: sanitizeSupabaseError(err, "Saved locally."),
      data: formattedPatient,
    };
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

  const visitDate =
    item.visitDate ||
    new Date().toLocaleDateString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    });

  const clinician = item.clinician || DEFAULT_CLINICIAN;
  const submittedBy = item.submittedBy || odfDetails.submittedBy || null;
  const procedure = item.procedure || "Oral Diagnosis Form (ODF)";
  const notes = item.notes || item.historyOfPresentIllness || "";
  const rawScanUrl = item.rawScanUrl || odfDetails.rawScanUrl || null;
  const rawScanPage2Url = item.rawScanPage2Url || odfDetails.rawScanPage2Url || null;
  const odontogramCropUrl = odfDetails.odontogramCropUrl;
  const consentCropUrl = odfDetails.consentCropUrl;

  try {
    const payload = {
      eight_digit_id: numericId,
      name: item.name || "Unnamed Patient",
      visit_date: visitDate,
      clinician,
      submitted_by: submittedBy,
      procedure,
      notes,
      status: "pending",
      raw_scan_url: rawScanUrl,
      raw_scan_page2_url: rawScanPage2Url,
      odontogram_crop_url: odontogramCropUrl,
      consent_crop_url: consentCropUrl,
      odf_details: odfDetails,
    };

    const { data, error } = await supabase
      .from("pending_approvals")
      .insert(payload)
      .select();

    if (error || !data?.length) {
      console.warn("[Supabase] savePending error:", error?.message || "No row returned");
      return {
        success: false,
        error: sanitizeSupabaseError(error, "Unable to submit ODF request."),
      };
    }

    const savedPending = normalizePending(data[0]);
    const localPending = getLocalPending();
    const updatedPending = [
      savedPending,
      ...localPending.filter((p) => String(p.submissionId || p.dbId || "") !== savedPending.submissionId),
    ];
    saveLocalPending(updatedPending);

    return {
      success: true,
      error: null,
      data: savedPending,
    };
  } catch (err) {
    console.warn("[Supabase] Unexpected error saving pending approval:", err);
    return {
      success: false,
      error: sanitizeSupabaseError(err, "Unable to submit ODF request."),
    };
  }
}

/**
 * Approve a pending ODF request via server-side RPC `approve_pending_submission`
 */
export async function approvePendingInSupabase(item) {
  const numericId = to8DigitId(item.id || item.eightDigitId);

  try {
    const { data, error } = await supabase.rpc("approve_pending_submission", {
      p_submission_id: item.dbId ? String(item.dbId) : "",
      p_eight_digit_id: numericId,
    });

    const patientRow = Array.isArray(data) ? data[0] : data;

    if (error || !patientRow) {
      console.warn("[Supabase] approvePending RPC error:", error?.message || "No data returned");
      return {
        success: false,
        error: sanitizeSupabaseError(error, "Approval failed. Please try again."),
      };
    }

    const normalizedPatient = normalizePatient(patientRow);

    // 1. Update local pending cache
    const targetDbId = item.dbId ? String(item.dbId) : null;
    const targetSubId = item.submissionId ? String(item.submissionId) : null;
    const localPending = getLocalPending();
    saveLocalPending(
      localPending.filter((p) => {
        if (targetDbId && p.dbId != null) return String(p.dbId) !== targetDbId;
        if (targetSubId && p.submissionId) return String(p.submissionId) !== targetSubId;
        return to8DigitId(p.id) !== numericId;
      })
    );

    // 2. Add to treatment records cache
    const treatmentRecord = {
      id: `rec_${numericId}_${Date.now()}`,
      patientId: numericId,
      title: item.procedure || "Approved Oral Diagnosis Form (ODF)",
      date: item.visitDate || new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
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
      hasOdontogram: !!(item.odfDetails?.odontogramCropUrl || item.odontogramCropUrl),
    };
    saveLocalRecord(treatmentRecord);

    // 3. Update local patients cache with the server-returned patient row
    const localPatients = getLocalPatients();
    saveLocalPatients([
      normalizedPatient,
      ...localPatients.filter((p) => to8DigitId(p.eightDigitId || p.id) !== normalizedPatient.eightDigitId),
    ]);

    return { success: true, data: normalizedPatient };
  } catch (err) {
    console.warn("[Supabase] Unexpected error approving pending item:", err);
    return {
      success: false,
      error: sanitizeSupabaseError(err, "Approval failed. Please try again."),
    };
  }
}

/**
 * Decline a pending ODF request
 */
export async function declinePendingInSupabase(item) {
  const numericId = to8DigitId(item.id || item.eightDigitId);

  try {
    let query = supabase
      .from("pending_approvals")
      .update({ status: "declined" });

    if (item.dbId) {
      query = query.eq("id", item.dbId);
    } else {
      query = query.eq("eight_digit_id", numericId);
    }

    const { data, error } = await query.select();

    if (error || !data?.length) {
      console.warn("[Supabase] declinePending error:", error?.message || "No rows updated");
      return {
        success: false,
        error: sanitizeSupabaseError(error, "Unable to decline submission."),
      };
    }

    const targetDbId = item.dbId ? String(item.dbId) : null;
    const targetSubId = item.submissionId ? String(item.submissionId) : null;
    const localPending = getLocalPending();
    saveLocalPending(
      localPending.filter((p) => {
        if (targetDbId && p.dbId != null) return String(p.dbId) !== targetDbId;
        if (targetSubId && p.submissionId) return String(p.submissionId) !== targetSubId;
        return to8DigitId(p.id) !== numericId;
      })
    );

    return { success: true };
  } catch (err) {
    console.warn("[Supabase] Unexpected error declining pending item:", err);
    return {
      success: false,
      error: sanitizeSupabaseError(err, "Unable to decline submission."),
    };
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

  // Also include any locally saved records for this patient (most recent first)
  const localRecs = getLocalRecords().filter((r) => r.patientId === numericId);
  localRecs.forEach((lr) => {
    recordsList.unshift({
      ...lr,
      dateFormatted: formatDateParts(lr.date),
    });
  });

  // Also include any locally pending ODF submissions for this patient so new submissions appear immediately in history
  const localPendingForPatient = getLocalPending().filter(
    (p) => to8DigitId(p.eightDigitId || p.id) === numericId
  );
  localPendingForPatient.forEach((lp) => {
    const details = lp.odfDetails || {};
    const alreadySavedAsApproved = localRecs.some(
      (lr) => lr.date === lp.visitDate && lr.title === lp.procedure
    );
    if (!alreadySavedAsApproved) {
      recordsList.unshift({
        id: lp.submissionId || `pending_${numericId}_${lp.visitDate || ""}`,
        date: lp.visitDate || new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
        dateFormatted: formatDateParts(lp.visitDate),
        title: lp.procedure || "Oral Diagnosis Form (ODF) Submission",
        type: "odf",
        typeLabel: "Pending ODF",
        status: "Pending Sign-off",
        clinician: lp.clinician || DEFAULT_CLINICIAN,
        summary: lp.notes || details.historyOfPresentIllness || "ODF Clinical Consultation",
        notes: lp.notes || details.historyOfPresentIllness || "",
        hasOdontogram: !!(details.odontogramCropUrl || lp.odontogramCropUrl),
        rawScanUrl: lp.rawScanUrl || details.rawScanUrl || null,
        rawScanPage2Url: lp.rawScanPage2Url || details.rawScanPage2Url || null,
        odontogramCropUrl: details.odontogramCropUrl || lp.odontogramCropUrl || null,
        consentCropUrl: details.consentCropUrl || lp.consentCropUrl || null,
        odfDetails: details,
      });
    }
  });

  // Include current patient.odfData if no local/baseline ODF already captures it
  if (patient.odfData && (patient.odfData.chiefComplaints?.some(Boolean) || patient.odfData.tentativeDiagnosis?.some(Boolean) || patient.odfData.rawScanUrl)) {
    const odf = patient.odfData;
    const visitDate = patient.lastVisit || odf.date || new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
    const hasMatchingOdf = recordsList.some(
      (r) => r.type === "odf" && (r.date === visitDate || r.odfDetails === odf)
    );
    if (!hasMatchingOdf) {
      recordsList.unshift({
        id: `odf_${numericId}_${visitDate}`,
        date: visitDate,
        dateFormatted: formatDateParts(visitDate),
        title: patient.procedure || "Oral Diagnosis Form (ODF) Submission",
        type: "odf",
        typeLabel: "ODF Form",
        status: "Clinical Record",
        clinician: patient.clinician || DEFAULT_CLINICIAN,
        summary: patient.procedure || "Clinical oral diagnosis and examination",
        notes: patient.notes || odf.historyOfPresentIllness || "",
        hasOdontogram: !!(odf.odontogramCropUrl || patient.odfData?.odontogramCropUrl),
        rawScanUrl: odf.rawScanUrl || patient.latestOdfScanUrl || null,
        rawScanPage2Url: odf.rawScanPage2Url || patient.latestOdfPage2Url || null,
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
      .eq("eight_digit_id", numericId);

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

  // Deduplicate by ID and exclude any deleted records
  const deletedRecordSet = new Set(getDeletedRecordIds());
  const seen = new Set();
  const deduped = [];
  for (const r of recordsList) {
    if (!deletedRecordSet.has(String(r.id)) && !seen.has(r.id)) {
      seen.add(r.id);
      deduped.push({
        ...r,
        dateFormatted: r.dateFormatted || formatDateParts(r.date),
      });
    }
  }

  // If list is empty for a newly added patient (and hasn't been explicitly deleted), supply a baseline initial exam record
  if (deduped.length === 0 && !deletedRecordSet.has(`init_${numericId}`)) {
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

/**
 * Deletes one or more selected clinical/ODF records belonging to a patient.
 * Available exclusively to Dentistry Department Faculty and System Administrators.
 */
export async function deleteSelectedPatientRecords(patient, recordsToDelete = []) {
  if (!patient || !Array.isArray(recordsToDelete) || recordsToDelete.length === 0) {
    return { success: false, deletedIds: [], error: "No records selected for deletion." };
  }
  const numericId = to8DigitId(patient.id || patient.eightDigitId);
  const targetIds = recordsToDelete.map((r) => (typeof r === "string" ? r : r.id)).filter(Boolean);
  const targetIdSet = new Set(targetIds);

  // Verify every remote Supabase deletion succeeds BEFORE modifying local blocklists or caches
  for (const record of recordsToDelete) {
    const id = typeof record === "string" ? record : record?.id;
    const recordDbId = typeof record === "object" && record !== null ? record.dbId : null;
    if (!id) continue;

    try {
      if (id.startsWith("tr_")) {
        const dbRecordId = id.slice(3);
        const { error } = await supabase.from("treatment_records").delete().eq("id", dbRecordId);
        if (error) {
          return {
            success: false,
            deletedIds: [],
            error: sanitizeSupabaseError(error, "Delete failed."),
          };
        }
      } else if (id.startsWith("appr_")) {
        const apprId = id.split("_")[1];
        if (apprId) {
          const { error } = await supabase.from("pending_approvals").delete().eq("id", apprId);
          if (error) {
            return {
              success: false,
              deletedIds: [],
              error: sanitizeSupabaseError(error, "Delete failed."),
            };
          }
        }
      } else if (recordDbId) {
        const { error } = await supabase.from("pending_approvals").delete().eq("id", recordDbId);
        if (error) {
          return {
            success: false,
            deletedIds: [],
            error: sanitizeSupabaseError(error, "Delete failed."),
          };
        }
      }
    } catch (err) {
      console.warn("[Supabase] Error deleting record:", id, err);
      return {
        success: false,
        deletedIds: [],
        error: sanitizeSupabaseError(err, "Delete failed."),
      };
    }
  }

  // Persist deleted record IDs (including init_ marker so cleared baseline doesn't re-spawn)
  addDeletedRecordIds([...targetIds, `init_${numericId}`]);

  // Remove from local treatment records cache
  const nextLocalRecords = getLocalRecords().filter((r) => !targetIdSet.has(r.id));
  saveLocalRecordsList(nextLocalRecords);

  // Remove matching pending entries if user deleted a pending ODF row
  const nextLocalPending = getLocalPending().filter((p) => {
    const subId = p.submissionId || `pending_${to8DigitId(p.eightDigitId || p.id)}_${p.visitDate || ""}`;
    if (targetIdSet.has(subId) || targetIdSet.has(p.submissionId) || targetIdSet.has(String(p.dbId))) {
      return false;
    }
    return true;
  });
  saveLocalPending(nextLocalPending);

  return { success: true, deletedIds: targetIds };
}

/**
 * Deletes an entire patient record along with all associated history and pending ODF submissions.
 * Available exclusively to Dentistry Department Faculty and System Administrators.
 */
export async function deleteEntirePatient(patient) {
  if (!patient) return { success: false, error: "No patient selected." };
  const numericId = to8DigitId(patient.id || patient.eightDigitId);

  // Verify all remote Supabase deletions succeed BEFORE adding to blocklist or mutating caches
  try {
    const { error: pendingError } = await supabase
      .from("pending_approvals")
      .delete()
      .eq("eight_digit_id", numericId);
    if (pendingError) {
      return {
        success: false,
        error: sanitizeSupabaseError(pendingError, "Delete failed."),
      };
    }

    if (patient.dbId && isUuid(patient.dbId)) {
      const { error: treatmentError } = await supabase
        .from("treatment_records")
        .delete()
        .eq("patient_id", patient.dbId);
      if (treatmentError) {
        return {
          success: false,
          error: sanitizeSupabaseError(treatmentError, "Delete failed."),
        };
      }

      const { error: patientByIdError } = await supabase
        .from("patients")
        .delete()
        .eq("id", patient.dbId);
      if (patientByIdError) {
        return {
          success: false,
          error: sanitizeSupabaseError(patientByIdError, "Delete failed."),
        };
      }
    }

    const { error: patientByNumError } = await supabase
      .from("patients")
      .delete()
      .eq("eight_digit_id", numericId);
    if (patientByNumError) {
      return {
        success: false,
        error: sanitizeSupabaseError(patientByNumError, "Delete failed."),
      };
    }
  } catch (err) {
    console.warn("[Supabase] Error deleting patient:", numericId, err);
    return {
      success: false,
      error: sanitizeSupabaseError(err, "Delete failed."),
    };
  }

  // 1. Add patient ID to deleted blocklist so default seeds / stale caches never resurrect it
  addDeletedPatientIds([numericId]);

  // 2. Remove from local patients, records, and pending caches
  const nextPatients = getLocalPatients().filter((p) => to8DigitId(p.eightDigitId || p.id) !== numericId);
  saveLocalPatients(nextPatients);

  const nextRecords = getLocalRecords().filter((r) => to8DigitId(r.patientId) !== numericId);
  saveLocalRecordsList(nextRecords);

  const nextPending = getLocalPending().filter((p) => to8DigitId(p.eightDigitId || p.id) !== numericId);
  saveLocalPending(nextPending);

  return { success: true, patientId: numericId };
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
      return {
        connected: true,
        tableFound: false,
        error: sanitizeSupabaseError(error, "Database connection requires an active authorized session."),
      };
    }
    return { connected: true, tableFound: true, error: null };
  } catch (err) {
    return {
      connected: false,
      tableFound: false,
      error: sanitizeSupabaseError(err, "Unable to reach Supabase service."),
    };
  }
}
