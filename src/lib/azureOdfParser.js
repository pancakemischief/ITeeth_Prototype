/**
 * Azure AI Document Intelligence client & CEU Makati Oral Diagnosis Form (ODF) mapper.
 * Supports both:
 *  1. "prebuilt-layout" (OCR lines, keyValuePairs, and structured tables)
 *  2. Custom Neural models trained in Azure Document Intelligence Studio (labeled fields & tables)
 */

// Condition keys and human labels for CEU ODF Section C: Past History (3x4 grid)
const PAST_HISTORY_CONDITIONS = [
  {
    id: "rheumaticHeart",
    aliases: ["rheumaticheart", "rheumaticheartdisease", "rheumatic heart disease"],
  },
  {
    id: "myocardialInfarct",
    aliases: ["myocardialinfarct", "myocardial infarction", "myocardial infarct"],
  },
  {
    id: "cerebroVascular",
    aliases: [
      "cerebrovascular",
      "cerebrovascularaccident",
      "cerebro-vascular accident",
      "cerebro vascular accident",
    ],
  },
  {
    id: "asthma",
    aliases: ["asthma"],
  },
  {
    id: "diabetes",
    aliases: ["diabetes"],
  },
  {
    id: "liverDisease",
    aliases: ["liverdisease", "liver disease"],
  },
  {
    id: "stomachUlcers",
    aliases: ["stomachulcers", "stomach ulcers", "stomach ulcer"],
  },
  {
    id: "kidneyDisease",
    aliases: ["kidneydisease", "kidney disease"],
  },
  {
    id: "pregnancy",
    aliases: ["pregnancy"],
  },
  {
    id: "tb",
    aliases: ["tb", "t.b.", "t.b", "tuberculosis"],
  },
  {
    id: "hypertension",
    aliases: ["hypertension"],
  },
  {
    id: "hypotension",
    aliases: ["hypotension"],
  },
];

function normalizeKey(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function cleanExtractedText(val) {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/^[:\s\-_]+/, "")
    .replace(/[\s_]+$/, "")
    .replace(/:selected:|:unselected:/gi, "")
    .trim();
}

/**
 * Distinguishes CEU Past History handwritten marks:
 * "/" (or checkmarks / "yes" / "present") -> "present"
 * "X" (or "x" / "none" / "no") -> "none"
 */
export function interpretCeuHistoryMark(rawVal) {
  if (rawVal === null || rawVal === undefined) return null;
  const s = String(rawVal).trim();
  if (!s) return null;

  // Explicit slash or checkmark -> condition present
  if (/^(\/|✓|✔|check|present|yes|positive|\+)$/i.test(s)) {
    return "present";
  }
  // Explicit X or cross -> condition absent ("none")
  if (/^(x|✕|✖|✗|✘|none|no|negative|-)$/i.test(s)) {
    return "none";
  }

  // Handle cases where OCR reads "[ / ]" or "(X)" around the mark
  if (/\//.test(s) && !/[a-z0-9]{2,}/i.test(s)) {
    return "present";
  }
  if (/^[(\s[]*[xX][)\s\]]*$/.test(s)) {
    return "none";
  }

  return null;
}

/**
 * Look up a value from Custom Neural `fields` or `keyValuePairs` by candidate names.
 */
function lookupValue(fieldsMap, kvList, candidateNames) {
  const normalizedCandidates = candidateNames.map(normalizeKey);

  // 1. Check Custom Neural fields first (highest precision)
  if (fieldsMap && typeof fieldsMap === "object") {
    for (const [fieldKey, fieldObj] of Object.entries(fieldsMap)) {
      const normField = normalizeKey(fieldKey);
      if (normalizedCandidates.includes(normField)) {
        const val = cleanExtractedText(fieldObj?.value ?? fieldObj?.content ?? "");
        if (val) return val;
      }
    }
  }

  // 2. Check prebuilt-layout keyValuePairs
  if (Array.isArray(kvList)) {
    for (const kv of kvList) {
      const normKvKey = normalizeKey(kv.key);
      if (!normKvKey) continue;
      if (
        normalizedCandidates.some(
          (cand) => normKvKey === cand || normKvKey.endsWith(cand) || normKvKey.startsWith(cand)
        )
      ) {
        const val = cleanExtractedText(kv.value);
        if (val) return val;
      }
    }
  }

  return "";
}

/**
 * Send scanned ODF blob/file to backend `/api/ocr/azure-odf`.
 */
export async function analyzeOdfWithAzure(blob, pageNumber = 1, fileName = `odf_page_${pageNumber}.jpg`) {
  const formData = new FormData();
  const file =
    blob instanceof File
      ? blob
      : new File([blob], fileName, { type: blob?.type || "image/jpeg" });

  formData.append("document", file);
  formData.append("pageNumber", String(pageNumber));

  const response = await fetch("/api/ocr/azure-odf", {
    method: "POST",
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));

  if (response.status === 503 || payload?.configured === false) {
    return {
      configured: false,
      error: payload?.error || "Azure Document Intelligence is not configured.",
    };
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Azure OCR failed with HTTP ${response.status}`);
  }

  return payload;
}

/**
 * Map Azure Document Intelligence output for CEU ODF Page 1 into form state updates.
 */
export function parseAzurePage1ToForm(azureResult, prevForm) {
  const fields = azureResult?.fields || {};
  const kvPairs = azureResult?.keyValuePairs || [];
  const tables = azureResult?.tables || [];
  const text = azureResult?.content || "";

  const updates = {};

  // --- 1. Demographics ---
  const name =
    lookupValue(fields, kvPairs, ["PatientName", "Name", "FullName"]) ||
    cleanExtractedText(text.match(/(?:^|\n)\s*Name[:\s]+([^\n]+?)(?:\s+Home\s*Address|\s+Date|$)/i)?.[1]);
  if (name) updates.name = name;

  const homeAddress =
    lookupValue(fields, kvPairs, ["HomeAddress", "Address"]) ||
    cleanExtractedText(text.match(/(?:Home\s*Address|Address)[:\s]+([^\n]+)/i)?.[1]);
  if (homeAddress) updates.homeAddress = homeAddress;

  const birthDate =
    lookupValue(fields, kvPairs, ["BirthDate", "Birthdate", "DateOfBirth", "DOB"]) ||
    cleanExtractedText(text.match(/(?:Birth\s*date|Birthdate|DOB)[:\s]+([0-9/\-.]+)/i)?.[1]);
  if (birthDate) updates.birthDate = birthDate;

  const age =
    lookupValue(fields, kvPairs, ["Age"]) ||
    cleanExtractedText(text.match(/\bAge[:\s]+(\d{1,3})\b/i)?.[1]);
  if (age) updates.age = age;

  const rawSex =
    lookupValue(fields, kvPairs, ["Sex", "Gender"]) ||
    cleanExtractedText(text.match(/\bSex[:\s]+(Male|Female|M|F)\b/i)?.[1]);
  if (rawSex) {
    updates.sex = rawSex.toUpperCase().startsWith("F") ? "Female" : "Male";
  }

  const height =
    lookupValue(fields, kvPairs, ["Height", "Ht"]) ||
    cleanExtractedText(text.match(/\bHt\.?[:\s]+([0-9'"\s.cmftin]+)/i)?.[1]);
  if (height) updates.height = height;

  const weight =
    lookupValue(fields, kvPairs, ["Weight", "Wt"]) ||
    cleanExtractedText(text.match(/\bWt\.?[:\s]+([0-9.\s]+(?:kg|lbs|lb)?)/i)?.[1]);
  if (weight) updates.weight = weight;

  const rawCivil =
    lookupValue(fields, kvPairs, ["CivilStatus", "Status"]) ||
    cleanExtractedText(text.match(/(?:Civil\s*Status)[:\s]+(Single|Married|Widowed|Separated)/i)?.[1]);
  if (rawCivil) {
    const matchedStatus = ["Single", "Married", "Widowed", "Separated"].find(
      (s) => s.toLowerCase() === rawCivil.toLowerCase()
    );
    if (matchedStatus) updates.civilStatus = matchedStatus;
  }

  const homeTel =
    lookupValue(fields, kvPairs, ["HomeTel", "HomeTelNo", "HomeTelephone", "TelNo"]) ||
    cleanExtractedText(text.match(/(?:Home\s*Tel(?:\.|\s*No\.?)?)[:\s]+([0-9\-+\s()]{5,})/i)?.[1]);
  if (homeTel) updates.homeTel = homeTel;

  const cellPhone =
    lookupValue(fields, kvPairs, ["CellPhone", "CellphoneNo", "CellNo", "Mobile", "MobileNo"]) ||
    cleanExtractedText(text.match(/(?:Cell(?:\s*Phone)?(?:\s*No\.?)?)[:\s]+([0-9\-+\s()]{7,})/i)?.[1]);
  if (cellPhone) updates.cellPhone = cellPhone;

  const nationality =
    lookupValue(fields, kvPairs, ["Nationality"]) ||
    cleanExtractedText(
      text.match(/Nationality[:\s]+([A-Za-z\s]+?)(?:\s+Occupation|\s+Religion|\n|$)/i)?.[1]
    );
  if (nationality) updates.nationality = nationality;

  const occupation =
    lookupValue(fields, kvPairs, ["Occupation"]) ||
    cleanExtractedText(text.match(/Occupation[:\s]+([A-Za-z\s/.-]+?)(?:\s+Religion|\n|$)/i)?.[1]);
  if (occupation) updates.occupation = occupation;

  const religion =
    lookupValue(fields, kvPairs, ["Religion"]) ||
    cleanExtractedText(text.match(/Religion[:\s]+([A-Za-z\s.-]+?)(?:\n|$)/i)?.[1]);
  if (religion) updates.religion = religion;

  // --- 2. Case History (Chief Complaints & HPI) ---
  const updatedComplaints = [...(prevForm.chiefComplaints || ["", "", "", ""])];
  let hasComplaintUpdate = false;
  for (let i = 0; i < 4; i++) {
    const cVal = lookupValue(fields, kvPairs, [
      `ChiefComplaint${i + 1}`,
      `Complaint${i + 1}`,
      `ChiefComplaints_${i + 1}`,
    ]);
    if (cVal) {
      updatedComplaints[i] = cVal;
      hasComplaintUpdate = true;
    }
  }
  if (!hasComplaintUpdate) {
    const singleComplaint = lookupValue(fields, kvPairs, ["ChiefComplaint", "ChiefComplaints"]);
    if (singleComplaint) {
      updatedComplaints[0] = singleComplaint;
      hasComplaintUpdate = true;
    }
  }
  if (hasComplaintUpdate) {
    updates.chiefComplaints = updatedComplaints;
  }

  const hpi =
    lookupValue(fields, kvPairs, [
      "HistoryOfPresentIllness",
      "PresentIllness",
      "BHistoryOfPresentIllness",
    ]) ||
    cleanExtractedText(
      text.match(/History\s+of\s+Present\s+Illness[:\s]*([^\n]+(?:\n(?![A-Z]\.\s)[^\n]+)*)/i)?.[1]
    );
  if (hpi) updates.historyOfPresentIllness = hpi;

  // --- 3. Past History (3x4 "/" vs "X" grid + Allergy/Other/Medications) ---
  const updatedPastHistory = { ...(prevForm.pastHistory || {}) };
  let pastHistoryChanged = false;

  // 3a. Direct Custom Neural fields or KV pairs for each condition
  for (const cond of PAST_HISTORY_CONDITIONS) {
    const rawCondVal = lookupValue(fields, kvPairs, [cond.id, ...cond.aliases]);
    const interpreted = interpretCeuHistoryMark(rawCondVal);
    if (interpreted) {
      updatedPastHistory[cond.id] = interpreted;
      pastHistoryChanged = true;
    }
  }

  // 3b. Check tables detected by prebuilt-layout for Past History cells (e.g. "[/] Asthma" or adjacent cell "/" / "X")
  for (const table of tables) {
    for (const row of table.rows || []) {
      for (let c = 0; c < row.length; c++) {
        const cellText = row[c] || "";
        if (!cellText) continue;
        for (const cond of PAST_HISTORY_CONDITIONS) {
          const matchesCond = cond.aliases.some((alias) =>
            cellText.toLowerCase().includes(alias.toLowerCase())
          );
          if (matchesCond) {
            // Check prefix/suffix in same cell (e.g. "/ Asthma" or "X Asthma") or preceding/following cell
            const prefixToken = cellText
              .replace(new RegExp(cond.aliases.join("|"), "ig"), "")
              .trim();
            const markFromSameCell = interpretCeuHistoryMark(prefixToken);
            const markFromPrevCell = c > 0 ? interpretCeuHistoryMark(row[c - 1]) : null;
            const mark = markFromSameCell || markFromPrevCell;
            if (mark) {
              updatedPastHistory[cond.id] = mark;
              pastHistoryChanged = true;
            }
          }
        }
      }
    }
  }

  // 3c. Fallback regex scan on raw OCR lines for `[/] Condition` or `X Condition`
  for (const cond of PAST_HISTORY_CONDITIONS) {
    if (updatedPastHistory[cond.id] && pastHistoryChanged) continue;
    for (const alias of cond.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(`(?:^|\\s)([/xX✓✔✗])\\s*${escaped}`, "i");
      const m = text.match(rx);
      if (m?.[1]) {
        const interpreted = interpretCeuHistoryMark(m[1]);
        if (interpreted) {
          updatedPastHistory[cond.id] = interpreted;
          pastHistoryChanged = true;
          break;
        }
      }
    }
  }

  if (pastHistoryChanged) {
    updates.pastHistory = updatedPastHistory;
  }

  const allergySpecify =
    lookupValue(fields, kvPairs, ["AllergySpecify", "Allergy", "Allergies"]) ||
    cleanExtractedText(
      text.match(/Allergy,?\s*specify[:\s]+([^\n]+?)(?:\s+Other\s+Illnesses|\s+Medications|$)/i)?.[1]
    );
  if (allergySpecify) {
    updates.allergySpecify = allergySpecify;
    updates.allergyCheck = "present";
  } else {
    const rawAllergyMark = lookupValue(fields, kvPairs, ["AllergyCheck", "AllergyMark"]);
    const allergyMark = interpretCeuHistoryMark(rawAllergyMark);
    if (allergyMark) updates.allergyCheck = allergyMark;
  }

  const otherIllnesses =
    lookupValue(fields, kvPairs, ["OtherIllnesses", "OtherIllness"]) ||
    cleanExtractedText(
      text.match(/Other\s+Illnesses[:\s]+([^\n]+?)(?:\s+Medications|$)/i)?.[1]
    );
  if (otherIllnesses) updates.otherIllnesses = otherIllnesses;

  const medications =
    lookupValue(fields, kvPairs, [
      "Medications",
      "MedicationsCurrentlyTaking",
      "CurrentMedications",
    ]) ||
    cleanExtractedText(text.match(/Medications\s+currently\s+taking[:\s]+([^\n]+)/i)?.[1]);
  if (medications) updates.medications = medications;

  // --- 4. Dental History ---
  const prevExt = lookupValue(fields, kvPairs, ["PreviousExtraction"]);
  if (prevExt) {
    updates.previousExtraction = /^y/i.test(prevExt) ? "Yes" : "No";
  }
  const extWhen = lookupValue(fields, kvPairs, ["ExtractionWhen", "IfYesWhen"]);
  if (extWhen) updates.extractionWhen = extWhen;

  const denture = lookupValue(fields, kvPairs, ["Denture"]);
  if (denture) updates.denture = denture;
  const dentureSince = lookupValue(fields, kvPairs, ["DentureSinceWhen", "SinceWhen"]);
  if (dentureSince) updates.dentureSinceWhen = dentureSince;

  // --- 5. Vital Signs ---
  const bp =
    lookupValue(fields, kvPairs, ["BloodPressure", "BP"]) ||
    cleanExtractedText(text.match(/(?:\bBP\b|Blood\s*Pressure)[:\s]+(\d{2,3}\s*\/\s*\d{2,3})/i)?.[1]);
  if (bp) updates.bloodPressure = bp.replace(/\s+/g, "");

  const pulse =
    lookupValue(fields, kvPairs, ["PulseRate", "Pulse", "PR"]) ||
    cleanExtractedText(text.match(/(?:Pulse\s*Rate|\bPulse\b)[:\s]+(\d{2,3}(?:\s*bpm)?)/i)?.[1]);
  if (pulse) updates.pulseRate = pulse;

  const resp =
    lookupValue(fields, kvPairs, ["RespiratoryRate", "RespRate", "RR"]) ||
    cleanExtractedText(text.match(/(?:Resp\.?\s*Rate|Respiratory\s*Rate)[:\s]+(\d{1,3}(?:\s*cpm)?)/i)?.[1]);
  if (resp) updates.respiratoryRate = resp;

  const temp =
    lookupValue(fields, kvPairs, ["Temperature", "Temp"]) ||
    cleanExtractedText(text.match(/(?:Temperature|\bTemp\.?\b)[:\s]+([0-9.]+(?:\s*°?[CF])?)/i)?.[1]);
  if (temp) updates.temperature = temp;

  return updates;
}

/**
 * Map Azure Document Intelligence output for CEU ODF Page 2 into form state updates.
 * Handles Diagnostic Test table, Radiographic Interpretation, Diagnosis/Plan lists,
 * 9x10 Services Rendered / Treatment Approval table, CI Remarks, and Consent fields.
 */
export function parseAzurePage2ToForm(azureResult, prevForm) {
  const fields = azureResult?.fields || {};
  const kvPairs = azureResult?.keyValuePairs || [];
  const tables = azureResult?.tables || [];
  const text = azureResult?.content || "";

  const updates = {};

  // --- 1. Radiographic Interpretation, Examined By, Date, Clinic Level, CI Remarks ---
  const radio =
    lookupValue(fields, kvPairs, ["RadiographicInterpretation", "Radiographic"]) ||
    cleanExtractedText(
      text.match(/Radiographic\s+Interpretation[:\s]+([^\n]+(?:\n(?!Tentative)[^\n]+)*)/i)?.[1]
    );
  if (radio) updates.radiographicInterpretation = radio;

  const examinedBy =
    lookupValue(fields, kvPairs, ["ExaminedBy", "Clinician", "StudentClinician"]) ||
    cleanExtractedText(text.match(/Examined\s+by[:\s]+([^\n]+?)(?:\s+Date|\s+Clinic\s+Level|$)/i)?.[1]);
  if (examinedBy) updates.examinedBy = examinedBy;

  const examDate =
    lookupValue(fields, kvPairs, ["ExamDate", "DateExamined", "Date"]) ||
    cleanExtractedText(text.match(/Examined\s+by[^\n]*?\bDate[:\s]+([0-9/\-.]+)/i)?.[1]);
  if (examDate) updates.examDate = examDate;

  const clinicLevel =
    lookupValue(fields, kvPairs, ["ClinicLevel", "Level"]) ||
    cleanExtractedText(text.match(/Clinic\s+Level[:\s]+([^\n]+)/i)?.[1]);
  if (clinicLevel) updates.clinicLevel = clinicLevel;

  const ciRemarks =
    lookupValue(fields, kvPairs, ["CIRemarks", "Remarks", "ClinicalInstructorRemarks"]) ||
    cleanExtractedText(text.match(/C\.?I\.?'?s?\s+Remarks[:\s]+([^\n]+)/i)?.[1]);
  if (ciRemarks) updates.ciRemarks = ciRemarks;

  // --- 2. Tentative Diagnosis (up to 6 items) & Recommended Treatment Plan (up to 6 items) ---
  const updatedDiag = [...(prevForm.tentativeDiagnosis || ["", "", "", "", "", ""])];
  let diagChanged = false;
  for (let i = 0; i < 6; i++) {
    const val = lookupValue(fields, kvPairs, [
      `TentativeDiagnosis${i + 1}`,
      `Diagnosis${i + 1}`,
    ]);
    if (val) {
      updatedDiag[i] = val;
      diagChanged = true;
    }
  }
  if (diagChanged) updates.tentativeDiagnosis = updatedDiag;

  const updatedPlan = [...(prevForm.recommendedTreatmentPlan || ["", "", "", "", "", ""])];
  let planChanged = false;
  for (let i = 0; i < 6; i++) {
    const val = lookupValue(fields, kvPairs, [
      `RecommendedTreatmentPlan${i + 1}`,
      `TreatmentPlan${i + 1}`,
      `Plan${i + 1}`,
    ]);
    if (val) {
      updatedPlan[i] = val;
      planChanged = true;
    }
  }
  if (planChanged) updates.recommendedTreatmentPlan = updatedPlan;

  // --- 3. Structured Tables from Azure Document Intelligence ---
  for (const table of tables) {
    const rows = table.rows || [];
    if (rows.length < 2) continue;

    const headerJoined = (rows[0] || []).join(" ").toLowerCase();

    // 3a. Diagnostic Tests Table (Tooth No., Mobility, Palpation, Percussion, Cavity, Hot, Cold, Anesthetic, Electric)
    if (
      headerJoined.includes("mobility") ||
      headerJoined.includes("percussion") ||
      headerJoined.includes("palpation") ||
      headerJoined.includes("pulp")
    ) {
      const parsedDiagRows = [];
      for (let r = 1; r < rows.length; r++) {
        const cells = rows[r];
        if (!cells || cells.every((c) => !cleanExtractedText(c))) continue;
        parsedDiagRows.push({
          toothNo: cleanExtractedText(cells[0]),
          mobility: cleanExtractedText(cells[1]),
          palpation: cleanExtractedText(cells[2]),
          percussion: cleanExtractedText(cells[3]),
          cavity: cleanExtractedText(cells[4]),
          hotTest: cleanExtractedText(cells[5]),
          coldTest: cleanExtractedText(cells[6]),
          anesthetic: cleanExtractedText(cells[7]),
          electricPulp: cleanExtractedText(cells[8]),
        });
      }
      if (parsedDiagRows.length > 0) {
        updates.diagnosticTests = parsedDiagRows;
      }
      continue;
    }

    // 3b. 9-Column x 10-Row Treatment Approval / Services Rendered Table
    // Columns 0..3: Date | Cases/Approved | Tooth No. | O.D. C.I
    // Column 4: Divider (when 9 cols) OR omitted by OCR (when 8 cols)
    // Columns 5..8 (or 4..7): Date | Cases/Approved | Tooth No. | O.D. C.I
    if (
      (headerJoined.includes("cases") || headerJoined.includes("approved")) &&
      headerJoined.includes("date")
    ) {
      const colCount = table.columnCount || (rows[0]?.length ?? 0);
      const rightOffset = colCount >= 9 ? 5 : 4;

      const logRows = Array.from({ length: 10 }, (_, idx) => {
        const existing = prevForm.treatmentLogRows?.[idx] || {
          leftDate: "",
          leftCasesApproved: "",
          leftToothNo: "",
          leftCi: "",
          rightDate: "",
          rightCasesApproved: "",
          rightToothNo: "",
          rightCi: "",
        };
        const dataRow = rows[idx + 1];
        if (!dataRow) return existing;

        return {
          leftDate: cleanExtractedText(dataRow[0]) || existing.leftDate,
          leftCasesApproved: cleanExtractedText(dataRow[1]) || existing.leftCasesApproved,
          leftToothNo: cleanExtractedText(dataRow[2]) || existing.leftToothNo,
          leftCi: cleanExtractedText(dataRow[3]) || existing.leftCi,
          rightDate: cleanExtractedText(dataRow[rightOffset]) || existing.rightDate,
          rightCasesApproved:
            cleanExtractedText(dataRow[rightOffset + 1]) || existing.rightCasesApproved,
          rightToothNo: cleanExtractedText(dataRow[rightOffset + 2]) || existing.rightToothNo,
          rightCi: cleanExtractedText(dataRow[rightOffset + 3]) || existing.rightCi,
        };
      });

      const flatLog = [];
      logRows.forEach((r) => {
        if (r.leftDate || r.leftCasesApproved || r.leftToothNo || r.leftCi) {
          flatLog.push({
            date: r.leftDate,
            casesApproved: r.leftCasesApproved,
            toothNo: r.leftToothNo,
            ciSign: r.leftCi,
          });
        }
      });
      logRows.forEach((r) => {
        if (r.rightDate || r.rightCasesApproved || r.rightToothNo || r.rightCi) {
          flatLog.push({
            date: r.rightDate,
            casesApproved: r.rightCasesApproved,
            toothNo: r.rightToothNo,
            ciSign: r.rightCi,
          });
        }
      });

      updates.treatmentLogRows = logRows;
      if (flatLog.length > 0) {
        updates.treatmentLog = flatLog;
      }
    }
  }

  // --- 4. Consent Form Fields ---
  const consentPatientName = lookupValue(fields, kvPairs, [
    "ConsentPatientName",
    "PatientSignatureName",
  ]);
  if (consentPatientName) updates.consentPatientName = consentPatientName;

  const consentHomeAddress = lookupValue(fields, kvPairs, ["ConsentHomeAddress"]);
  if (consentHomeAddress) updates.consentHomeAddress = consentHomeAddress;

  const consentDate = lookupValue(fields, kvPairs, ["ConsentDate"]);
  if (consentDate) updates.consentDate = consentDate;

  const consentGuardianName = lookupValue(fields, kvPairs, [
    "ConsentGuardianName",
    "ParentGuardianName",
  ]);
  if (consentGuardianName) updates.consentGuardianName = consentGuardianName;

  const consentMinorPatientName = lookupValue(fields, kvPairs, ["ConsentMinorPatientName"]);
  if (consentMinorPatientName) updates.consentMinorPatientName = consentMinorPatientName;

  const consentClinicianName = lookupValue(fields, kvPairs, [
    "ConsentClinicianName",
    "ClinicianSignature",
  ]);
  if (consentClinicianName) updates.consentClinicianName = consentClinicianName;

  const consentClinicianDate = lookupValue(fields, kvPairs, ["ConsentClinicianDate"]);
  if (consentClinicianDate) updates.consentClinicianDate = consentClinicianDate;

  return updates;
}
