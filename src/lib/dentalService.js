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
  const posHash = Math.abs(hash) % 90000000 + 10000000;
  return String(posHash);
}

/**
 * Checks if a string is a valid UUID
 */
function isUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str));
}

export const DEFAULT_CLINICIAN = "Dr. Jane Doe, MD";

/**
 * Normalizes a database row from `patients` table to standard UI patient object
 */
function normalizePatient(row, index = 1) {
  let meta = {};
  if (row.medical_history) {
    try {
      meta = JSON.parse(row.medical_history);
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

  const eightDigitId = to8DigitId(meta.eightDigitId || row.eight_digit_id || row.id, index);

  return {
    id: eightDigitId,
    dbId: row.id,
    eightDigitId,
    name: fullName,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    email: row.email || "",
    phone: row.phone || "",
    gender: row.gender || "",
    dateOfBirth: row.date_of_birth || "",
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
  return {
    id: to8DigitId(row.id, index),
    name: row.name || "Unknown Patient",
    visitDate: row.visit_date || row.visitDate || "01/01/2026",
    clinician: row.clinician || DEFAULT_CLINICIAN,
    procedure: row.procedure || "Oral Diagnosis Form (ODF)",
    notes: row.notes || "",
    status: row.status || "pending",
    type: row.type || "ODF Submission",
    odfDetails: row.odf_details || null,
    submittedAt: row.created_at || new Date().toISOString(),
  };
}

/**
 * Fetch patients from Supabase `patients` table
 */
export async function fetchPatientsFromSupabase() {
  try {
    const { data, error } = await supabase
      .from("patients")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[Supabase] fetchPatients error:", error.message);
      return { success: false, error: error.message, data: null };
    }

    return {
      success: true,
      error: null,
      data: Array.isArray(data) ? data.map((r, i) => normalizePatient(r, i + 1)) : [],
    };
  } catch (err) {
    console.warn("[Supabase] Unexpected error fetching patients:", err);
    return { success: false, error: err.message, data: null };
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
      return { success: false, error: error.message, data: null };
    }

    return {
      success: true,
      error: null,
      data: Array.isArray(data) ? data.map((r, i) => normalizePending(r, i + 1)) : [],
    };
  } catch (err) {
    console.warn("[Supabase] Unexpected error fetching pending:", err);
    return { success: false, error: err.message, data: null };
  }
}

/**
 * Save or update a patient in Supabase
 */
export async function savePatientToSupabase(patient) {
  try {
    const nameParts = (patient.name || "").trim().split(/\s+/);
    const firstName = patient.firstName || nameParts[0] || "Unnamed";
    const lastName = patient.lastName || nameParts.slice(1).join(" ") || "Patient";
    const numericId = to8DigitId(patient.id || patient.eightDigitId);

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
      odfData: patient.odfData || null,
    };

    const payload = {
      first_name: firstName,
      last_name: lastName,
      email: patient.email || null,
      phone: patient.phone || null,
      date_of_birth: patient.dateOfBirth || null,
      gender: patient.gender || null,
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
        return { success: false, error: error.message };
      }
      return { success: true, data: data?.[0] ? normalizePatient(data[0]) : null };
    } else {
      const { data, error } = await supabase
        .from("patients")
        .insert(payload)
        .select();

      if (error) {
        console.warn("[Supabase] savePatient insert error:", error.message);
        return { success: false, error: error.message };
      }
      return { success: true, data: data?.[0] ? normalizePatient(data[0]) : null };
    }
  } catch (err) {
    console.warn("[Supabase] Unexpected error saving patient:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Upload cropped or scanned ODF image to Supabase Storage bucket 'odf-scans'
 * If storage bucket is not yet configured, returns dataUrl directly so app never fails.
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
      console.warn("[Supabase Storage] Upload notice (using fallback):", error.message);
      // Fallback: If blob is passed, convert to Data URL so it is always preserved
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
 */
export async function savePendingToSupabase(item) {
  try {
    const numericId = to8DigitId(item.id);
    const payload = {
      id: numericId,
      name: item.name,
      visit_date:
        item.visitDate ||
        new Date().toLocaleDateString("en-US", {
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
        }),
      clinician: item.clinician || DEFAULT_CLINICIAN,
      procedure: item.procedure || "Oral Diagnosis Form (ODF)",
      notes: item.notes || null,
      status: item.status || "pending",
      odf_details: item.odfDetails || item,
    };

    if (item.odontogramCropUrl) {
      payload.odontogram_crop_url = item.odontogramCropUrl;
    }
    if (item.consentCropUrl) {
      payload.consent_crop_url = item.consentCropUrl;
    }

    const { data, error } = await supabase
      .from("pending_approvals")
      .upsert(payload, { onConflict: "id" })
      .select();

    if (error) {
      console.warn("[Supabase] savePending error:", error.message);
      return { success: false, error: error.message };
    }

    return { success: true, data: data?.[0] ? normalizePending(data[0]) : null };
  } catch (err) {
    console.warn("[Supabase] Unexpected error saving pending approval:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Approve a pending ODF request
 */
export async function approvePendingInSupabase(item) {
  try {
    const { error: pendingErr } = await supabase
      .from("pending_approvals")
      .update({ status: "approved" })
      .eq("id", item.id);

    if (pendingErr) {
      console.warn("[Supabase] approvePending update error:", pendingErr.message);
    }

    const patientResult = await savePatientToSupabase({
      id: item.id,
      name: item.name,
      lastVisit: item.visitDate,
      clinician: item.clinician || DEFAULT_CLINICIAN,
      procedure: item.procedure || "Approved Oral Diagnosis Form (ODF)",
      notes: item.notes || "Approved faculty procedure and ODF documentation.",
      odfData: item.odfDetails || null,
    });

    return { success: true, data: patientResult.data };
  } catch (err) {
    console.warn("[Supabase] Unexpected error approving pending item:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Decline a pending ODF request
 */
export async function declinePendingInSupabase(item) {
  try {
    const { error } = await supabase
      .from("pending_approvals")
      .update({ status: "declined" })
      .eq("id", item.id);

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
