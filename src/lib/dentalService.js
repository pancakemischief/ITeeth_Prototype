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

export const UNASSIGNED_CLINICIAN = "Unassigned Clinician";
export const DEFAULT_CLINICIAN = UNASSIGNED_CLINICIAN;

export function getTodayManilaIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function getTodayManilaDisplay() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(new Date());
}

const PHI_STORAGE_PREFIX = "iteeth_";

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
    clinician: UNASSIGNED_CLINICIAN,
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
    clinician: UNASSIGNED_CLINICIAN,
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
    clinician: UNASSIGNED_CLINICIAN,
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
    clinician: UNASSIGNED_CLINICIAN,
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

// Ephemeral in-memory state (never persisted to localStorage/sessionStorage)
let inMemoryPatients = [];
let inMemoryPending = [];
let inMemoryRecords = [];
let inMemoryDeletedPatientIds = [];
let inMemoryDeletedRecordIds = [];

function removeKeysByPrefix(storage, prefix) {
  if (!storage) return;
  try {
    const keysToRemove = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => storage.removeItem(key));
  } catch {
    // ignore storage access errors
  }
}

/**
 * Clears all in-memory PHI caches and purges any `iteeth_*` keys from browser storage.
 */
export function clearAllLocalPhi() {
  inMemoryPatients = [];
  inMemoryPending = [];
  inMemoryRecords = [];
  inMemoryDeletedPatientIds = [];
  inMemoryDeletedRecordIds = [];

  if (typeof localStorage !== "undefined") {
    removeKeysByPrefix(localStorage, PHI_STORAGE_PREFIX);
  }
  if (typeof sessionStorage !== "undefined") {
    removeKeysByPrefix(sessionStorage, PHI_STORAGE_PREFIX);
  }
}

export function getDeletedPatientIds() {
  return inMemoryDeletedPatientIds;
}

function addDeletedPatientIds(ids = []) {
  const next = Array.from(new Set([...getDeletedPatientIds(), ...ids.map((id) => to8DigitId(id))]));
  inMemoryDeletedPatientIds = next;
  return next;
}

export function getDeletedRecordIds() {
  return inMemoryDeletedRecordIds;
}

function addDeletedRecordIds(ids = []) {
  const next = Array.from(new Set([...getDeletedRecordIds(), ...ids.filter(Boolean).map(String)]));
  inMemoryDeletedRecordIds = next;
  return next;
}

export function getLocalPatients() {
  const deletedSet = new Set(getDeletedPatientIds());
  return inMemoryPatients.filter((p) => !deletedSet.has(to8DigitId(p?.eightDigitId || p?.id)));
}

export function saveLocalPatients(patients) {
  inMemoryPatients = Array.isArray(patients) ? patients : [];
}

export function getLocalPending() {
  return inMemoryPending;
}

export function saveLocalPending(pending) {
  inMemoryPending = Array.isArray(pending) ? pending : [];
}

export function getLocalRecords() {
  return inMemoryRecords;
}

export function saveLocalRecord(record) {
  inMemoryRecords = [record, ...getLocalRecords().filter((r) => r.id !== record.id)];
}

function saveLocalRecordsList(records) {
  inMemoryRecords = Array.isArray(records) ? records : [];
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
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila",
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
      }).format(new Date(row.created_at))
    : getTodayManilaDisplay();

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
    clinician: meta.clinician || row.clinician || UNASSIGNED_CLINICIAN,
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
    visitDate: row.visit_date || getTodayManilaDisplay(),
    clinician: row.clinician || UNASSIGNED_CLINICIAN,
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
        error: sanitizeSupabaseError(error, "Unable to fetch patient records."),
        data: [],
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
      error: sanitizeSupabaseError(err, "Unable to fetch patient records."),
      data: [],
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
        error: sanitizeSupabaseError(error, "Unable to fetch pending submissions."),
        data: [],
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
      error: sanitizeSupabaseError(err, "Unable to fetch pending submissions."),
      data: [],
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
    clinician: patient.clinician || UNASSIGNED_CLINICIAN,
    lastVisit: patient.lastVisit || getTodayManilaDisplay(),
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

function getSanitizedFileExtension(fileOrBlob, fileName = "") {
  const nameMatch = String(fileName || "").match(/\.([a-zA-Z0-9]+)$/);
  if (nameMatch?.[1]) {
    const sanitized = nameMatch[1].toLowerCase().replace(/[^a-z0-9]/g, "");
    if (sanitized) return sanitized;
  }
  const mime = String(fileOrBlob?.type || "").toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("pdf")) return "pdf";
  return "jpg";
}

/**
 * Upload cropped or scanned ODF image to private Supabase Storage bucket 'odf-scans'
 * using an unguessable UUID object path. Returns the storage object path on success, or null on failure.
 */
export async function uploadOdfImageToStorage(fileOrBlob, fileName) {
  if (!fileOrBlob) return null;
  try {
    const uuid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    const ext = getSanitizedFileExtension(fileOrBlob, fileName);
    const cleanFileName = `${uuid}.${ext}`;

    const { error } = await supabase.storage
      .from("odf-scans")
      .upload(cleanFileName, fileOrBlob, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.warn("[Supabase Storage] Upload failed:", error.message);
      return null;
    }

    return cleanFileName;
  } catch (err) {
    console.warn("[Supabase Storage] Unexpected upload error:", err);
    return null;
  }
}

/**
 * Resolves an ODF scan path or legacy storage URL into a short-lived signed URL.
 */
export async function resolveOdfScanSignedUrl(pathOrUrl, expiresInSeconds = 300) {
  if (!pathOrUrl || typeof pathOrUrl !== "string") return null;
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return null;

  if (
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("/assets/")
  ) {
    return trimmed;
  }

  let objectPath = trimmed;
  const publicMarker = "/storage/v1/object/public/odf-scans/";
  const signMarker = "/storage/v1/object/sign/odf-scans/";

  if (trimmed.includes(publicMarker)) {
    objectPath = trimmed.split(publicMarker)[1].split("?")[0];
  } else if (trimmed.includes(signMarker)) {
    objectPath = trimmed.split(signMarker)[1].split("?")[0];
  } else if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  } else {
    objectPath = trimmed.split("?")[0].replace(/^\/+/, "");
  }

  if (!objectPath) return null;

  try {
    objectPath = decodeURIComponent(objectPath);
  } catch {
    // keep raw objectPath if malformed URI encoding
  }

  try {
    const { data, error } = await supabase.storage
      .from("odf-scans")
      .createSignedUrl(objectPath, expiresInSeconds);

    if (error) {
      console.warn("[Supabase Storage] Failed to create signed URL:", error.message);
      return null;
    }
    return data?.signedUrl || null;
  } catch (err) {
    console.warn("[Supabase Storage] Unexpected signed URL error:", err);
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

  const visitDate = item.visitDate || getTodayManilaDisplay();

  const clinician = item.clinician || UNASSIGNED_CLINICIAN;
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
      date: item.visitDate || getTodayManilaDisplay(),
      clinician: item.clinician || UNASSIGNED_CLINICIAN,
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

  const recordsList = [];

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
        date: lp.visitDate || getTodayManilaDisplay(),
        dateFormatted: formatDateParts(lp.visitDate),
        title: lp.procedure || "Oral Diagnosis Form (ODF) Submission",
        type: "odf",
        typeLabel: "Pending ODF",
        status: "Pending Sign-off",
        clinician: lp.clinician || UNASSIGNED_CLINICIAN,
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
    const visitDate = patient.lastVisit || odf.date || getTodayManilaDisplay();
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
        clinician: patient.clinician || UNASSIGNED_CLINICIAN,
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
          const treatmentDate =
            t.treatment_date ||
            (t.created_at
              ? new Intl.DateTimeFormat("en-US", {
                  timeZone: "Asia/Manila",
                  month: "2-digit",
                  day: "2-digit",
                  year: "numeric",
                }).format(new Date(t.created_at))
              : getTodayManilaDisplay());
          recordsList.unshift({
            id: `tr_${t.id}`,
            date: treatmentDate,
            dateFormatted: formatDateParts(t.treatment_date || t.created_at),
            title: t.procedure_name || "Dental Treatment",
            type: "treatment",
            typeLabel: "Treatment Record",
            status: "Recorded in DB",
            toothNo: t.tooth_number ? `Tooth #${t.tooth_number}` : null,
            clinician: patient.clinician || UNASSIGNED_CLINICIAN,
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
          date: appr.visit_date || getTodayManilaDisplay(),
          dateFormatted: formatDateParts(appr.visit_date),
          title: appr.procedure || "Oral Diagnosis Form (ODF)",
          type: "odf",
          typeLabel: appr.status === "approved" ? "Approved ODF" : "Pending ODF",
          status: appr.status === "approved" ? "Faculty Approved" : "Pending Sign-off",
          clinician: appr.clinician || UNASSIGNED_CLINICIAN,
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
  if (!dateStr) return { month: "DATE", day: "—", year: "" };
  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const str = String(dateStr).trim();

  const isoDateMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDateMatch) {
    const year = isoDateMatch[1];
    const mIdx = Math.max(0, Math.min(11, parseInt(isoDateMatch[2], 10) - 1));
    const day = isoDateMatch[3].padStart(2, "0");
    return { month: monthNames[mIdx] || "DATE", day, year };
  }

  const slashMatch = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slashMatch) {
    const mIdx = Math.max(0, Math.min(11, parseInt(slashMatch[1], 10) - 1));
    const day = slashMatch[2].padStart(2, "0");
    const year = slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3];
    return { month: monthNames[mIdx] || "DATE", day, year };
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const manilaIso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    const parts = manilaIso.split("-");
    if (parts.length === 3) {
      const mIdx = Math.max(0, Math.min(11, parseInt(parts[1], 10) - 1));
      return { month: monthNames[mIdx] || "DATE", day: parts[2], year: parts[0] };
    }
  }

  return { month: "DATE", day: str, year: "" };
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
  saveLocalRecordsList(updatedRecs);

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
