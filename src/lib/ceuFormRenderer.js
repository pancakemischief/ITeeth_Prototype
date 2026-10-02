/**
 * Renders high-fidelity, printable SVG representations of CEU Makati Oral Diagnosis Forms (Page 1 & 2)
 * Matches the official Centro Escolar University School of Dentistry paper forms.
 */

export function generateCeuOdfPage1Svg(data = {}) {
  const name = data.name || "Patient Chart";
  const birthDate = data.birthDate || data.dateOfBirth || "";
  const age = data.age || "";
  const sex = data.sex || data.gender || "Male";
  const homeAddress = data.homeAddress || "Makati City";
  const cellPhone = data.cellPhone || data.phone || "";
  const bloodPressure = data.bloodPressure || "120/80";
  const pulseRate = data.pulseRate || "72 bpm";
  const respiratoryRate = data.respiratoryRate || "16 cpm";
  const temperature = data.temperature || "36.5 °C";
  const complaints = data.chiefComplaints || [];
  const hpi = data.historyOfPresentIllness || data.notes || "";
  const eightDigitId = data.eightDigitId || data.id || "10000001";
  const clinician = data.clinician || "Student Clinician";

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1130" width="100%" height="100%" style="background:#ffffff; font-family: 'Times New Roman', Times, serif; color: #111827;">
      <style>
        .title { font-size: 16px; font-weight: bold; text-anchor: middle; }
        .sub-title { font-size: 13px; text-anchor: middle; font-style: italic; }
        .form-title { font-size: 15px; font-weight: bold; text-anchor: middle; letter-spacing: 1px; }
        .section-header { font-size: 13px; font-weight: bold; }
        .label { font-size: 11px; font-weight: bold; }
        .val { font-size: 11px; font-family: Arial, sans-serif; fill: #1e3a8a; }
        .grid-line { stroke: #374151; stroke-width: 0.8; }
        .box { fill: none; stroke: #374151; stroke-width: 1; }
      </style>

      <!-- Border Page -->
      <rect x="20" y="20" width="760" height="1090" class="box" stroke-width="1.5" />

      <!-- Header -->
      <text x="400" y="52" class="title">Centro Escolar University</text>
      <text x="400" y="70" class="sub-title">School of Dentistry</text>
      <text x="400" y="86" style="font-size: 11px; text-anchor: middle;">Manila * Malolos * Makati</text>
      <text x="400" y="108" class="form-title">ORAL DIAGNOSIS FORM</text>

      <text x="680" y="50" style="font-size: 10px; font-family: monospace; fill: #6b7280; font-weight: bold;">ID: ${eightDigitId}</text>
      <text x="680" y="66" style="font-size: 9px; font-family: monospace; fill: #059669; font-weight: bold;">CEU MAKATI</text>

      <!-- Demographics Line 1 -->
      <text x="40" y="138" class="label">Name:</text>
      <line x1="85" y1="139" x2="380" y2="139" class="grid-line" />
      <text x="92" y="136" class="val" font-weight="bold">${name}</text>

      <text x="400" y="138" class="label">Home Address:</text>
      <line x1="495" y1="139" x2="750" y2="139" class="grid-line" />
      <text x="502" y="136" class="val">${homeAddress}</text>

      <!-- Demographics Line 2 -->
      <text x="40" y="162" class="label">Birth Date:</text>
      <line x1="110" y1="163" x2="230" y2="163" class="grid-line" />
      <text x="115" y="160" class="val">${birthDate || "1995-04-12"}</text>

      <text x="245" y="162" class="label">Age:</text>
      <line x1="275" y1="163" x2="330" y2="163" class="grid-line" />
      <text x="282" y="160" class="val">${age || "28"}</text>

      <text x="345" y="162" class="label">Sex:</text>
      <line x1="375" y1="163" x2="440" y2="163" class="grid-line" />
      <text x="385" y="160" class="val">${sex}</text>

      <text x="455" y="162" class="label">Ht.:</text>
      <line x1="480" y1="163" x2="540" y2="163" class="grid-line" />
      <text x="485" y="160" class="val">5'7"</text>

      <text x="555" y="162" class="label">Wt.:</text>
      <line x1="580" y1="163" x2="635" y2="163" class="grid-line" />
      <text x="585" y="160" class="val">64 kg</text>

      <text x="648" y="162" class="label">Civil Status:</text>
      <line x1="715" y1="163" x2="750" y2="163" class="grid-line" />
      <text x="718" y="160" class="val">Single</text>

      <!-- Demographics Line 3 -->
      <text x="40" y="186" class="label">Home Tel. No.:</text>
      <line x1="125" y1="187" x2="230" y2="187" class="grid-line" />
      <text x="130" y="184" class="val">02-8812-4091</text>

      <text x="245" y="186" class="label">Cell Phone No.:</text>
      <line x1="335" y1="187" x2="450" y2="187" class="grid-line" />
      <text x="340" y="184" class="val">${cellPhone || "0917-555-0101"}</text>

      <text x="465" y="186" class="label">Nationality:</text>
      <line x1="535" y1="187" x2="620" y2="187" class="grid-line" />
      <text x="540" y="184" class="val">Filipino</text>

      <text x="635" y="186" class="label">Religion:</text>
      <line x1="685" y1="187" x2="750" y2="187" class="grid-line" />
      <text x="690" y="184" class="val">RC</text>

      <!-- CASE HISTORY -->
      <text x="400" y="214" class="section-header" text-anchor="middle">Case History</text>

      <text x="40" y="234" class="section-header">A. Chief Complaint/s:</text>
      <text x="55" y="252" class="label">1.</text>
      <line x1="75" y1="254" x2="750" y2="254" class="grid-line" />
      <text x="85" y="251" class="val">${complaints[0] || "Evaluation and management of tooth discomfort upon chewing"}</text>

      <text x="55" y="272" class="label">2.</text>
      <line x1="75" y1="274" x2="750" y2="274" class="grid-line" />
      <text x="85" y="271" class="val">${complaints[1] || "Mild thermal sensitivity to cold beverages"}</text>

      <text x="55" y="292" class="label">3.</text>
      <line x1="75" y1="294" x2="750" y2="294" class="grid-line" />
      <text x="85" y="291" class="val">${complaints[2] || ""}</text>

      <text x="40" y="316" class="section-header">B. History of Present Illness:</text>
      <line x1="205" y1="318" x2="750" y2="318" class="grid-line" />
      <text x="215" y="315" class="val">${(hpi || "Patient reports onset of symptoms 2-3 weeks ago.").slice(0, 75)}</text>
      <line x1="40" y1="335" x2="750" y2="335" class="grid-line" />
      <text x="45" y="332" class="val">${(hpi || "").slice(75, 160)}</text>

      <!-- C. Past History Table -->
      <text x="40" y="358" class="section-header">C. Past History: Mark (/) if any of conditions are present and (X) if none.</text>

      <rect x="40" y="366" width="710" height="76" class="box" />
      <line x1="240" y1="366" x2="240" y2="442" class="grid-line" />
      <line x1="440" y1="366" x2="440" y2="442" class="grid-line" />
      <line x1="590" y1="366" x2="590" y2="442" class="grid-line" />

      <line x1="40" y1="385" x2="750" y2="385" class="grid-line" />
      <line x1="40" y1="404" x2="750" y2="404" class="grid-line" />
      <line x1="40" y1="423" x2="750" y2="423" class="grid-line" />

      <!-- Conditions text -->
      <text x="45" y="380" style="font-size: 10px;">[ X ] Rheumatic Heart Disease</text>
      <text x="245" y="380" style="font-size: 10px;">[ X ] Asthma</text>
      <text x="445" y="380" style="font-size: 10px;">[ X ] Stomach Ulcers</text>
      <text x="595" y="380" style="font-size: 10px;">[ X ] T.B.</text>

      <text x="45" y="399" style="font-size: 10px;">[ X ] Myocardial Infarct</text>
      <text x="245" y="399" style="font-size: 10px;">[ X ] Diabetes</text>
      <text x="445" y="399" style="font-size: 10px;">[ X ] Kidney Disease</text>
      <text x="595" y="399" style="font-size: 10px;">[ X ] Hypertension</text>

      <text x="45" y="418" style="font-size: 10px;">[ X ] Cerebro-Vascular Accident</text>
      <text x="245" y="418" style="font-size: 10px;">[ X ] Liver Disease</text>
      <text x="445" y="418" style="font-size: 10px;">[ X ] Pregnancy</text>
      <text x="595" y="418" style="font-size: 10px;">[ X ] Hypotension</text>

      <text x="45" y="437" style="font-size: 10px;">Allergy: None noted</text>
      <text x="245" y="437" style="font-size: 10px;">Medications: None currently</text>

      <!-- CLINICAL EXAMINATION -->
      <text x="400" y="462" class="section-header" text-anchor="middle">Clinical Examination</text>

      <text x="40" y="482" class="section-header">A. Extraoral</text>
      <text x="140" y="482" style="font-size: 11px;">Head: <tspan class="val">Normal</tspan></text>
      <text x="280" y="482" style="font-size: 11px;">TMJ: <tspan class="val">Normal</tspan></text>
      <text x="420" y="482" style="font-size: 11px;">Eyes: <tspan class="val">Normal</tspan></text>

      <text x="40" y="504" class="label">Vital Signs:</text>
      <text x="120" y="504" style="font-size: 11px;">BP: <tspan class="val">${bloodPressure}</tspan></text>
      <text x="240" y="504" style="font-size: 11px;">Pulse: <tspan class="val">${pulseRate}</tspan></text>
      <text x="370" y="504" style="font-size: 11px;">Resp: <tspan class="val">${respiratoryRate}</tspan></text>
      <text x="500" y="504" style="font-size: 11px;">Temp: <tspan class="val">${temperature}</tspan></text>

      <text x="40" y="526" class="section-header">B. Intraoral</text>
      <text x="120" y="526" style="font-size: 10.5px;">Lip: <tspan class="val">Normal</tspan></text>
      <text x="220" y="526" style="font-size: 10.5px;">Palate: <tspan class="val">Normal</tspan></text>
      <text x="320" y="526" style="font-size: 10.5px;">Tongue: <tspan class="val">Normal</tspan></text>
      <text x="430" y="526" style="font-size: 10.5px;">Gingiva: <tspan class="val">Normal</tspan></text>
      <text x="540" y="526" style="font-size: 10.5px;">Occlusion: <tspan class="val">Class I</tspan></text>

      <!-- SECTION C: ODONTOGRAM -->
      <text x="40" y="556" class="section-header">C. Mouth Examination (Odontogram Chart)</text>

      <!-- Legend Box -->
      <rect x="40" y="565" width="280" height="150" class="box" />
      <line x1="160" y1="565" x2="160" y2="715" class="grid-line" />
      <line x1="40" y1="585" x2="320" y2="585" class="grid-line" />

      <text x="100" y="579" style="font-size: 10px; font-weight: bold; fill: #dc2626; text-anchor: middle;">Red Code</text>
      <text x="240" y="579" style="font-size: 10px; font-weight: bold; fill: #2563eb; text-anchor: middle;">Blue Code</text>

      <text x="45" y="600" style="font-size: 9.5px;">C - Caries</text>
      <text x="45" y="615" style="font-size: 9.5px;">Abr - Abrasion</text>
      <text x="45" y="630" style="font-size: 9.5px;">Fr - Fracture</text>
      <text x="45" y="645" style="font-size: 9px; font-weight: bold;">NO SHADE</text>
      <text x="45" y="660" style="font-size: 9px;">Ex - Extraction</text>
      <text x="45" y="675" style="font-size: 9px;">X - Missing</text>

      <text x="165" y="600" style="font-size: 9.5px;">/ - Present w/o caries</text>
      <text x="165" y="615" style="font-size: 9.5px;">Am - Amalgam</text>
      <text x="165" y="630" style="font-size: 9.5px;">Co - Composite</text>
      <text x="165" y="645" style="font-size: 9.5px;">GI - Glass Ionomer</text>
      <text x="165" y="660" style="font-size: 9.5px;">JC - Jacket Crown</text>
      <text x="165" y="675" style="font-size: 9.5px;">FPD - Fixed Partial</text>

      <!-- Deciduous & Primary Dentition Schematic Graphic -->
      <g transform="translate(340, 565)">
        <rect x="0" y="0" width="410" height="150" fill="#f9fafb" stroke="#cbd5e1" rx="4" />
        <text x="205" y="20" style="font-size: 10.5px; font-weight: bold; text-anchor: middle; fill: #475569;">Deciduous Teeth (55-65 / 85-75)</text>
        
        <!-- Primary Teeth Numbering -->
        <text x="25" y="40" style="font-size: 8px;">55 54 53 52 51 | 61 62 63 64 65</text>
        <text x="25" y="75" style="font-size: 8px;">85 84 83 82 81 | 71 72 73 74 75</text>

        <!-- Odontogram Circles Schematic -->
        <g transform="translate(30, 90)">
          ${[55, 54, 53, 52, 51, 61, 62, 63, 64, 65].map((num, i) => `
            <circle cx="${i * 35 + 15}" cy="15" r="10" fill="#ffffff" stroke="#374151" stroke-width="1.2"/>
            <circle cx="${i * 35 + 15}" cy="15" r="4" fill="${i === 1 ? '#ef4444' : '#ffffff'}" stroke="#374151" stroke-width="0.8"/>
            <text x="${i * 35 + 15}" y="38" style="font-size: 8px; text-anchor: middle; fill: #6b7280;">${num}</text>
          `).join("")}
        </g>
      </g>

      <!-- Permanent Dentition Teeth Chart (18-28 and 48-38) -->
      <g transform="translate(40, 730)">
        <rect x="0" y="0" width="710" height="300" fill="#fdfdfd" stroke="#374151" stroke-width="1.2" />

        <text x="355" y="24" style="font-size: 12px; font-weight: bold; text-anchor: middle; fill: #111827; letter-spacing: 0.5px;">
          Maxillary Teeth (18 17 16 15 14 13 12 11 | 21 22 23 24 25 26 27 28)
        </text>

        <!-- Maxillary Row -->
        <g transform="translate(15, 35)">
          ${[18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28].map((num, i) => `
            <g transform="translate(${i * 42.5}, 0)">
              <!-- Tooth Crown Schematic -->
              <rect x="4" y="0" width="34" height="42" fill="#ffffff" stroke="#374151" rx="4" />
              <circle cx="21" cy="21" r="9" fill="${num === 14 ? '#ef4444' : '#f0fdf4'}" stroke="#374151" stroke-width="1"/>
              <!-- Root schematic -->
              <path d="M 10 42 C 10 65, 14 85, 21 95 C 28 85, 32 65, 32 42 Z" fill="#fafafa" stroke="#374151"/>
              <text x="21" y="112" style="font-size: 9.5px; font-weight: bold; text-anchor: middle; fill: #1f2937;">${num}</text>
            </g>
          `).join("")}
        </g>

        <!-- Midline separation -->
        <line x1="355" y1="30" x2="355" y2="285" stroke="#dc2626" stroke-width="1" stroke-dasharray="3,3" />

        <text x="355" y="170" style="font-size: 12px; font-weight: bold; text-anchor: middle; fill: #111827; letter-spacing: 0.5px;">
          Mandibular Teeth (48 47 46 45 44 43 42 41 | 31 32 33 34 35 36 37 38)
        </text>

        <!-- Mandibular Row -->
        <g transform="translate(15, 180)">
          ${[48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38].map((num, i) => `
            <g transform="translate(${i * 42.5}, 0)">
              <!-- Root schematic pointing up -->
              <path d="M 10 30 C 10 15, 15 5, 21 0 C 27 5, 32 15, 32 30 Z" fill="#fafafa" stroke="#374151"/>
              <!-- Crown Schematic -->
              <rect x="4" y="30" width="34" height="42" fill="#ffffff" stroke="#374151" rx="4" />
              <circle cx="21" cy="51" r="9" fill="${num === 30 || num === 19 ? '#3b82f6' : '#ffffff'}" stroke="#374151" stroke-width="1"/>
              <text x="21" y="90" style="font-size: 9.5px; font-weight: bold; text-anchor: middle; fill: #1f2937;">${num}</text>
            </g>
          `).join("")}
        </g>
      </g>

      <!-- Clinician signature line at bottom -->
      <text x="520" y="1065" class="label">Attending Clinician:</text>
      <line x1="620" y1="1066" x2="745" y2="1066" class="grid-line" />
      <text x="630" y="1063" class="val" font-weight="bold">${clinician}</text>

      <text x="400" y="1092" style="font-size: 11px; text-anchor: middle; fill: #6b7280; font-weight: bold;">Page 1 of 2</text>
    </svg>
  `;
}

export function generateCeuOdfPage2Svg(data = {}) {
  const name = data.name || "Patient Chart";
  const age = data.age || "28";
  const sex = data.sex || data.gender || "Male";
  const address = data.homeAddress || "Makati City";
  const tentativeDiag = data.tentativeDiagnosis || ["Dental Caries", "Gingivitis"];
  const treatmentPlan = data.recommendedTreatmentPlan || ["Restorative Treatment", "Oral Prophylaxis"];
  const clinician = data.clinician || "Student Clinician";
  const examDate = data.examDate || new Date().toISOString().split("T")[0];
  const eightDigitId = data.eightDigitId || data.id || "10000001";

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1130" width="100%" height="100%" style="background:#ffffff; font-family: 'Times New Roman', Times, serif; color: #111827;">
      <style>
        .section-header { font-size: 13px; font-weight: bold; }
        .label { font-size: 11px; font-weight: bold; }
        .val { font-size: 11px; font-family: Arial, sans-serif; fill: #1e3a8a; }
        .grid-line { stroke: #374151; stroke-width: 0.8; }
        .box { fill: none; stroke: #374151; stroke-width: 1; }
        .th { font-size: 9px; font-weight: bold; text-anchor: middle; }
      </style>

      <!-- Border Page -->
      <rect x="20" y="20" width="760" height="1090" class="box" stroke-width="1.5" />

      <!-- Top Header Badge -->
      <text x="40" y="50" style="font-size: 13px; font-weight: bold; fill: #0f172a;">Centro Escolar University • School of Dentistry</text>
      <text x="730" y="50" style="font-size: 10px; font-family: monospace; fill: #6b7280; text-anchor: end; font-weight: bold;">ID: ${eightDigitId}</text>

      <!-- SECTION D: DIAGNOSTIC TEST TABLE -->
      <text x="40" y="78" class="section-header">D. Diagnostic Test:</text>

      <!-- Diagnostic Table -->
      <g transform="translate(40, 88)">
        <rect x="0" y="0" width="710" height="90" class="box" />
        <!-- Table header line -->
        <line x1="0" y1="28" x2="710" y2="28" class="grid-line" stroke-width="1.2" />

        <!-- Vertical lines -->
        <line x1="70" y1="0" x2="70" y2="90" class="grid-line" />
        <line x1="140" y1="0" x2="140" y2="90" class="grid-line" />
        <line x1="210" y1="0" x2="210" y2="90" class="grid-line" />
        <line x1="290" y1="0" x2="290" y2="90" class="grid-line" />
        <line x1="370" y1="0" x2="370" y2="90" class="grid-line" />
        <line x1="450" y1="0" x2="450" y2="90" class="grid-line" />
        <line x1="530" y1="0" x2="530" y2="90" class="grid-line" />
        <line x1="620" y1="0" x2="620" y2="90" class="grid-line" />

        <!-- Headers -->
        <text x="35" y="18" class="th">Tooth No.</text>
        <text x="105" y="18" class="th">Mobility</text>
        <text x="175" y="18" class="th">Palpation</text>
        <text x="250" y="18" class="th">Percussion</text>
        <text x="330" y="18" class="th">Test Cavity</text>
        <text x="410" y="14" class="th">Hot Test</text>
        <text x="410" y="24" style="font-size: 8px; text-anchor: middle;">(duration)</text>
        <text x="490" y="14" class="th">Cold Test</text>
        <text x="490" y="24" style="font-size: 8px; text-anchor: middle;">(duration)</text>
        <text x="575" y="18" class="th">Anesthetic Test</text>
        <text x="665" y="18" class="th">Electric Pulp Test</text>

        <!-- Sample Row 1 -->
        <line x1="0" y1="58" x2="710" y2="58" class="grid-line" />
        <text x="35" y="46" class="val" text-anchor="middle" font-weight="bold">#19</text>
        <text x="105" y="46" class="val" text-anchor="middle">Grade 0</text>
        <text x="175" y="46" class="val" text-anchor="middle">Normal</text>
        <text x="250" y="46" class="val" text-anchor="middle">Normal</text>
        <text x="330" y="46" class="val" text-anchor="middle">Class II</text>
        <text x="410" y="46" class="val" text-anchor="middle">WNL</text>
        <text x="490" y="46" class="val" text-anchor="middle">Positive (3s)</text>
        <text x="575" y="46" class="val" text-anchor="middle">Negative</text>
        <text x="665" y="46" class="val" text-anchor="middle">WNL (4/10)</text>

        <!-- Sample Row 2 -->
        <text x="35" y="78" class="val" text-anchor="middle">#14</text>
        <text x="105" y="78" class="val" text-anchor="middle">Grade 0</text>
        <text x="175" y="78" class="val" text-anchor="middle">Normal</text>
        <text x="250" y="78" class="val" text-anchor="middle">Sensitive</text>
        <text x="330" y="78" class="val" text-anchor="middle">-</text>
        <text x="410" y="78" class="val" text-anchor="middle">Lingering</text>
        <text x="490" y="78" class="val" text-anchor="middle">Lingering (8s)</text>
        <text x="575" y="78" class="val" text-anchor="middle">Positive</text>
        <text x="665" y="78" class="val" text-anchor="middle">Low threshold</text>
      </g>

      <!-- Radiographic Interpretation -->
      <text x="40" y="202" class="section-header">Radiographic Interpretation:</text>
      <line x1="200" y1="204" x2="750" y2="204" class="grid-line" />
      <text x="210" y="201" class="val">Periapical and bitewing radiographs reveal radiolucency on coronal distal aspect of #19.</text>
      <line x1="40" y1="222" x2="750" y2="222" class="grid-line" />
      <text x="45" y="219" class="val">Lamina dura continuous. Alveolar crest height maintained within normal limits.</text>

      <!-- Tentative Diagnosis & Treatment Plan Columns -->
      <g transform="translate(40, 240)">
        <!-- Tentative Diagnosis Column -->
        <text x="170" y="16" class="section-header" text-anchor="middle">Tentative Diagnosis</text>
        ${[1, 2, 3, 4, 5, 6].map((num, i) => `
          <text x="0" y="${38 + i * 22}" class="label">${num}.</text>
          <line x1="20" y1="${40 + i * 22}" x2="330" y2="${40 + i * 22}" class="grid-line" />
          <text x="28" y="${37 + i * 22}" class="val">${tentativeDiag[i] || ""}</text>
        `).join("")}

        <!-- Recommended Treatment Plan Column -->
        <text x="530" y="16" class="section-header" text-anchor="middle">Recommended Treatment Plan</text>
        ${[1, 2, 3, 4, 5, 6].map((num, i) => `
          <text x="360" y="${38 + i * 22}" class="label">${num}.</text>
          <line x1="380" y1="${40 + i * 22}" x2="710" y2="${40 + i * 22}" class="grid-line" />
          <text x="388" y="${37 + i * 22}" class="val">${treatmentPlan[i] || ""}</text>
        `).join("")}
      </g>

      <!-- Examination metadata -->
      <g transform="translate(40, 420)">
        <text x="0" y="16" class="label">Examined by:</text>
        <line x1="85" y1="18" x2="300" y2="18" class="grid-line" />
        <text x="90" y="15" class="val" font-weight="bold">${clinician}</text>

        <text x="320" y="16" class="label">Date:</text>
        <line x1="355" y1="18" x2="480" y2="18" class="grid-line" />
        <text x="360" y="15" class="val">${examDate}</text>

        <text x="500" y="16" class="label">Clinic Level:</text>
        <line x1="575" y1="18" x2="710" y2="18" class="grid-line" />
        <text x="580" y="15" class="val">Clinical Dentistry II</text>
      </g>

      <!-- Treatment Approval Tracking Log Grid -->
      <g transform="translate(40, 455)">
        <rect x="0" y="0" width="710" height="95" class="box" />
        <line x1="0" y1="24" x2="710" y2="24" class="grid-line" stroke-width="1.2" />

        <line x1="355" y1="0" x2="355" y2="95" class="grid-line" stroke-width="1.2" />
        <line x1="75" y1="0" x2="75" y2="95" class="grid-line" />
        <line x1="210" y1="0" x2="210" y2="95" class="grid-line" />
        <line x1="285" y1="0" x2="285" y2="95" class="grid-line" />

        <line x1="430" y1="0" x2="430" y2="95" class="grid-line" />
        <line x1="565" y1="0" x2="565" y2="95" class="grid-line" />
        <line x1="640" y1="0" x2="640" y2="95" class="grid-line" />

        <text x="37" y="16" class="th">Date</text>
        <text x="142" y="16" class="th">Cases/Approved</text>
        <text x="247" y="16" class="th">Tooth No.</text>
        <text x="320" y="16" class="th">O.D. C.I.</text>

        <text x="392" y="16" class="th">Date</text>
        <text x="497" y="16" class="th">Cases/Approved</text>
        <text x="602" y="16" class="th">Tooth No.</text>
        <text x="675" y="16" class="th">O.D. C.I.</text>

        <!-- Sample Entry -->
        <line x1="0" y1="48" x2="710" y2="48" class="grid-line" />
        <text x="37" y="40" class="val" text-anchor="middle">${examDate}</text>
        <text x="142" y="40" class="val" text-anchor="middle" font-size="10px">ODF Faculty Sign-off</text>
        <text x="247" y="40" class="val" text-anchor="middle">#19</text>
        <text x="320" y="40" class="val" text-anchor="middle" font-weight="bold">APPROVED</text>
      </g>

      <!-- CI's Remarks -->
      <g transform="translate(40, 565)">
        <text x="0" y="16" class="label">CI's Remarks:</text>
        <line x1="85" y1="18" x2="710" y2="18" class="grid-line" />
        <text x="95" y="15" class="val">Case approved for restorative treatment under direct faculty supervision.</text>
        <line x1="0" y1="36" x2="710" y2="36" class="grid-line" />
        <line x1="0" y1="54" x2="710" y2="54" class="grid-line" />
      </g>

      <!-- Data Privacy Act Statement Policy -->
      <g transform="translate(40, 645)">
        <rect x="0" y="0" width="710" height="68" fill="#f8fafc" stroke="#cbd5e1" rx="4" />
        <text x="12" y="18" style="font-size: 11px; font-weight: bold; fill: #0f172a;">Data Privacy Act Statement Policy (Republic Act No. 10173)</text>
        <text x="12" y="34" style="font-size: 9.5px; fill: #475569;">
          Centro Escolar University is committed to respect and value the privacy rights of individuals. We will ensure that all personal data are protected
        </text>
        <text x="12" y="48" style="font-size: 9.5px; fill: #475569;">
          and processed in accordance with Republic Act No. 10173 or the Data Privacy Act of 2012 and its implementing Rules and Regulations. We
        </text>
        <text x="12" y="62" style="font-size: 9.5px; fill: #475569;">
          recognize the confidentiality of personal data and adhere to the general principles of transparency, legitimate purpose, and proportionality.
        </text>
      </g>

      <!-- DENTAL PROCEDURE CONSENT FORM -->
      <g transform="translate(40, 730)">
        <text x="355" y="18" class="form-title">Dental Procedure Consent Form</text>

        <!-- Adult Consent Box -->
        <rect x="0" y="30" width="345" height="295" class="box" />
        <text x="12" y="52" style="font-size: 11px; line-height: 1.6;">
          I, <tspan class="val" font-weight="bold">${name}</tspan>, <tspan class="val">${age}</tspan> years of age, <tspan class="val">${sex}</tspan>,
        </text>
        <text x="12" y="70" style="font-size: 11px;">
          a resident of <tspan class="val">${address}</tspan>,
        </text>
        <text x="12" y="90" style="font-size: 10.5px;">
          hereby consent to any dental examination and
        </text>
        <text x="12" y="106" style="font-size: 10.5px;">
          performance of any or all procedures, operation, and/or
        </text>
        <text x="12" y="122" style="font-size: 10.5px;">
          treatment that are considered necessary to be done at
        </text>
        <text x="12" y="138" style="font-size: 10.5px;">
          CEU Dental Infirmary specifically:
        </text>
        <line x1="12" y1="160" x2="330" y2="160" class="grid-line" />
        <text x="20" y="156" class="val" font-weight="bold">Oral Examination, Restoration & Scaling</text>

        <text x="12" y="182" style="font-size: 10.5px;">by: <tspan class="val">${clinician}</tspan></text>

        <text x="12" y="206" style="font-size: 9.5px; fill: #475569;">
          The procedures were clearly explained to me and that I am
        </text>
        <text x="12" y="220" style="font-size: 9.5px; fill: #475569;">
          in the right state of mind to decide on its merit.
        </text>

        <line x1="20" y1="275" x2="160" y2="275" class="grid-line" />
        <text x="25" y="290" style="font-size: 8.5px;">Patient's Printed Name & Sig.</text>

        <line x1="185" y1="275" x2="325" y2="275" class="grid-line" />
        <text x="195" y="290" style="font-size: 8.5px;">C.I.'s Signature & Date</text>

        <!-- Minor Consent Box -->
        <rect x="365" y="30" width="345" height="295" class="box" />
        <text x="377" y="50" class="section-header" style="font-size: 11px;">For Minor Patient</text>
        <text x="377" y="70" style="font-size: 10px; fill: #475569;">
          I, Parent/Guardian, hereby consent to dental
        </text>
        <text x="377" y="86" style="font-size: 10px; fill: #475569;">
          examination and treatment on behalf of ward at
        </text>
        <text x="377" y="102" style="font-size: 10px; fill: #475569;">
          CEU Dental Infirmary.
        </text>

        <line x1="385" y1="275" x2="525" y2="275" class="grid-line" />
        <text x="390" y="290" style="font-size: 8.5px;">Parents'/Guardian's Sig.</text>

        <line x1="550" y1="275" x2="690" y2="275" class="grid-line" />
        <text x="560" y="290" style="font-size: 8.5px;">C.I.'s Signature & Date</text>
      </g>

      <!-- Footer markings -->
      <g transform="translate(40, 1070)">
        <text x="0" y="0" style="font-size: 9.5px; fill: #6b7280;">Copy to student | AAF-DE-005 | 09/09/2019</text>
        <text x="355" y="0" style="font-size: 11px; text-anchor: middle; fill: #6b7280; font-weight: bold;">Page 2 of 2</text>
      </g>
    </svg>
  `;
}

/**
 * Returns a data URI for an SVG document
 */
export function svgToDataUri(svgString) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
}
