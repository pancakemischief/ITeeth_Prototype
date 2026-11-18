import React from "react";

const CONDITION_ALERTS = {
  allergy: { label: "Drug / Substance Allergy", severity: "critical", precaution: "Verify allergen before prescribing or administering local anesthesia" },
  rheumaticHeart: { label: "Rheumatic Heart Disease", severity: "critical", precaution: "Evaluate need for antibiotic prophylaxis prior to invasive care" },
  myocardialInfarct: { label: "History of Myocardial Infarction", severity: "critical", precaution: "Limit epinephrine; confirm medical clearance & stress-reduction protocol" },
  cerebroVascular: { label: "Cerebro-Vascular Accident (Stroke)", severity: "critical", precaution: "Check anticoagulant therapy & monitor blood pressure" },
  hypertension: { label: "Hypertension", severity: "high", precaution: "Monitor pre-operative BP; limit vasoconstrictor dose" },
  hypotension: { label: "Hypotension", severity: "moderate", precaution: "Avoid rapid supine-to-upright chair positioning" },
  diabetes: { label: "Diabetes Mellitus", severity: "high", precaution: "Confirm meal/insulin status to prevent hypoglycemia; monitor healing" },
  asthma: { label: "Asthma", severity: "high", precaution: "Ensure rescue inhaler is chairside; avoid sulfite-containing anesthetics" },
  pregnancy: { label: "Pregnancy", severity: "high", precaution: "Defer elective radiographs; use pregnancy-safe anesthetics/analgesics" },
  liverDisease: { label: "Liver Disease", severity: "high", precaution: "Adjust amide local anesthetic & acetaminophen dosing" },
  kidneyDisease: { label: "Kidney Disease", severity: "high", precaution: "Avoid nephrotoxic NSAIDs; adjust renally cleared medications" },
  tb: { label: "Tuberculosis (T.B.)", severity: "critical", precaution: "Verify active vs. treated status; enforce airborne infection control" },
  stomachUlcers: { label: "Stomach Ulcers", severity: "moderate", precaution: "Avoid aspirin and NSAID analgesics" },
};

const HIGH_RISK_KEYWORDS = [
  { pattern: /\b(warfarin|coumadin|heparin|apixaban|rivaroxaban|clopidogrel|plavix|anticoagulant|blood\s*thinner)\b/i, label: "Anticoagulant / Antiplatelet Therapy", precaution: "Assess INR/bleeding risk before surgical or periodontal procedures" },
  { pattern: /\b(hemophilia|bleeding\s*disorder|thrombocytopenia|von\s*willebrand)\b/i, label: "Bleeding Disorder", precaution: "Obtain hematology clearance & prepare local hemostatic agents" },
  { pattern: /\b(epilepsy|seizure)\b/i, label: "Seizure Disorder", precaution: "Minimize stress triggers & keep airway management ready" },
  { pattern: /\b(pacemaker|defibrillator)\b/i, label: "Cardiac Pacemaker / ICD", precaution: "Avoid ultrasonic scalers / electrosurgery per device guidelines" },
];

export function evaluateMedicalAlerts(source = {}) {
  const pastHistory = source?.pastHistory || {};
  const alerts = [];

  // 1. Allergies
  const allergyText = String(source?.allergySpecify || "").trim();
  const hasAllergyFlag =
    source?.allergyCheck === "present" ||
    source?.allergyCheck === true ||
    (allergyText && !/^(none|no|n\/a|nil)$/i.test(allergyText));

  if (hasAllergyFlag) {
    alerts.push({
      key: "allergy",
      title: allergyText ? `ALLERGY: ${allergyText}` : "ALLERGY REPORTED (Specify Substance)",
      severity: "critical",
      precaution: CONDITION_ALERTS.allergy.precaution,
    });
  }

  const localAnesthesiaAllergy = String(source?.localAnesthesiaAllergy || "").trim();
  if (localAnesthesiaAllergy && !/^(none|no|n\/a)$/i.test(localAnesthesiaAllergy)) {
    alerts.push({
      key: "la_allergy",
      title: `LOCAL ANESTHESIA REACTION: ${localAnesthesiaAllergy}`,
      severity: "critical",
      precaution: "Select alternative anesthetic class & verify sensitivity",
    });
  }

  // 2. Past Medical History Checklist
  Object.entries(CONDITION_ALERTS).forEach(([key, meta]) => {
    if (key === "allergy") return;
    if (pastHistory[key] === "present") {
      alerts.push({
        key,
        title: meta.label.toUpperCase(),
        severity: meta.severity,
        precaution: meta.precaution,
      });
    }
  });

  // 3. Blood Pressure Thresholds
  const bpRaw = String(source?.bloodPressure || "").trim();
  const bpMatch = bpRaw.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  if (bpMatch) {
    const systolic = parseInt(bpMatch[1], 10);
    const diastolic = parseInt(bpMatch[2], 10);
    if (systolic >= 180 || diastolic >= 120) {
      alerts.push({
        key: "bp_crisis",
        title: `HYPERTENSIVE CRISIS BP (${systolic}/${diastolic} mmHg)`,
        severity: "critical",
        precaution: "Defer elective dental treatment immediately & refer for medical evaluation",
      });
    } else if (systolic >= 140 || diastolic >= 90) {
      alerts.push({
        key: "bp_high",
        title: `ELEVATED BP (${systolic}/${diastolic} mmHg)`,
        severity: "high",
        precaution: "Re-check BP after 5 minutes rest; limit vasoconstrictor use",
      });
    } else if (systolic > 0 && systolic < 90) {
      alerts.push({
        key: "bp_low",
        title: `LOW BP (${systolic}/${diastolic} mmHg)`,
        severity: "moderate",
        precaution: "Monitor for syncope & adjust chair position slowly",
      });
    }
  }

  // 4. Medications, Other Illnesses & Extraction Complications Keyword Scan
  const freeTextNotes = [
    source?.medications,
    source?.otherIllnesses,
    source?.extractionComplications,
  ]
    .filter(Boolean)
    .join(" | ");

  if (freeTextNotes && !/^(none|no|n\/a|\s|\|)*$/i.test(freeTextNotes)) {
    HIGH_RISK_KEYWORDS.forEach((rule, idx) => {
      if (rule.pattern.test(freeTextNotes)) {
        alerts.push({
          key: `kw_${idx}`,
          title: rule.label.toUpperCase(),
          severity: "high",
          precaution: rule.precaution,
        });
      }
    });
  }

  const screenedConditionsCount = Object.values(pastHistory).filter(
    (v) => v === "present" || v === "none"
  ).length;
  const allergyScreened =
    source?.allergyCheck === "present" ||
    source?.allergyCheck === "none" ||
    source?.allergyCheck === true;

  const isScreened = screenedConditionsCount > 0 || allergyScreened || Boolean(bpMatch);

  return { alerts, isScreened };
}

export default function MedicalAlertBanner({ odfData = null, patient = null, record = null }) {
  const merged = {
    ...(patient?.odfData || {}),
    ...(record?.odfDetails || {}),
    ...(odfData || {}),
  };

  const { alerts, isScreened } = evaluateMedicalAlerts(merged);

  if (alerts.length > 0) {
    return (
      <div
        role="alert"
        style={{
          background: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)",
          border: "2px solid #dc2626",
          borderRadius: "12px",
          padding: "12px 16px",
          marginBottom: "12px",
          color: "#7f1d1d",
          boxShadow: "0 4px 12px rgba(220, 38, 38, 0.14)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "8px",
            marginBottom: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                background: "#dc2626",
                color: "#ffffff",
                fontWeight: "800",
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "6px",
                letterSpacing: "0.4px",
              }}
            >
              ⚠️ MEDICAL ALERT ({alerts.length})
            </span>
            <strong style={{ fontSize: "13px", color: "#991b1b" }}>
              Pre-Procedure Clinical Precautions Required
            </strong>
          </div>
          {merged.medications && (
            <span style={{ fontSize: "11.5px", fontWeight: "700", color: "#991b1b" }}>
              Current Meds: {merged.medications}
            </span>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "6px" }}>
          {alerts.map((a) => (
            <span
              key={a.key}
              title={a.precaution}
              style={{
                background: a.severity === "critical" ? "#b91c1c" : "#dc2626",
                color: "#ffffff",
                fontSize: "11.5px",
                fontWeight: "700",
                padding: "3px 10px",
                borderRadius: "999px",
              }}
            >
              {a.title}
            </span>
          ))}
        </div>

        <ul style={{ margin: "4px 0 0", paddingLeft: "18px", fontSize: "11.5px", lineHeight: "1.45" }}>
          {alerts.map((a) => (
            <li key={`${a.key}_note`}>
              <strong>{a.title}:</strong> {a.precaution}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!isScreened) {
    return (
      <div
        role="status"
        style={{
          background: "#fffbeb",
          border: "1.5px solid #f59e0b",
          borderRadius: "10px",
          padding: "8px 14px",
          marginBottom: "10px",
          color: "#92400e",
          fontSize: "12px",
          fontWeight: "600",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span>🩺</span>
        <span>
          <strong>Medical History Unscreened:</strong> Verify allergies, Past History conditions, and vital signs before administering anesthesia or performing procedures.
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      style={{
        background: "#ecfdf5",
        border: "1px solid #6ee7b7",
        borderRadius: "10px",
        padding: "6px 14px",
        marginBottom: "10px",
        color: "#065f46",
        fontSize: "12px",
        fontWeight: "600",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <span>✓</span>
      <span>
        <strong>Medical Alert Check Cleared:</strong> No drug allergies, elevated blood pressure, or systemic red flags reported.
      </span>
    </div>
  );
}