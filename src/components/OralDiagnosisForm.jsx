import { useState } from "react";
import { DEFAULT_CLINICIAN, to8DigitId } from "../lib/dentalService";
import "./OralDiagnosisForm.css";

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

const createInitialForm = (patientId, initialData, currentUser) => ({
  eightDigitId: to8DigitId(patientId || Date.now()),
  name: "",
  homeAddress: "",
  birthDate: "",
  age: "",
  sex: "",
  cellPhone: "",
  homeTel: "",
  email: "",
  chiefComplaints: ["", "", "", ""],
  historyOfPresentIllness: "",
  medicalConditions: [],
  allergySpecify: "",
  otherIllnesses: "",
  medications: "",
  previousExtraction: "No",
  extractionWhen: "",
  head: "Normal",
  headSpecify: "",
  eyes: "Normal",
  eyesSpecify: "",
  tmj: "Normal",
  tmjSpecify: "",
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
  bloodPressure: "",
  pulseRate: "",
  respiratoryRate: "",
  temperature: "",
  radiographicInterpretation: "",
  tentativeDiagnosis: ["", "", "", "", "", ""],
  recommendedTreatmentPlan: ["", "", "", "", "", ""],
  ciRemarks: "",
  examinedBy: currentUser?.role || "",
  examDate: new Date().toISOString().slice(0, 10),
  clinicLevel: "",
  clinician: currentUser?.role || DEFAULT_CLINICIAN,
  ...initialData,
});

export default function OralDiagnosisForm({
  patientId,
  initialData = null,
  onSave = () => {},
  onCancel = () => {},
  currentUser,
}) {
  const [form, setForm] = useState(() => createInitialForm(patientId, initialData, currentUser));

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updateListItem = (field, index, value) => {
    setForm((current) => {
      const items = [...(current[field] || [])];
      items[index] = value;
      return { ...current, [field]: items };
    });
  };

  const toggleMedicalCondition = (condition) => {
    setForm((current) => {
      const conditions = current.medicalConditions || [];
      return {
        ...current,
        medicalConditions: conditions.includes(condition)
          ? conditions.filter((item) => item !== condition)
          : [...conditions, condition],
      };
    });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const activeClinician = form.clinician || currentUser?.role || DEFAULT_CLINICIAN;
    const details = {
      ...form,
      eightDigitId: to8DigitId(form.eightDigitId || patientId || Date.now()),
      clinician: activeClinician,
      submittedBy: currentUser?.email || "",
      clinicianRole: currentUser?.role || "",
    };

    onSave({
      id: details.eightDigitId,
      eightDigitId: details.eightDigitId,
      name: (details.name || "").trim() || "Unnamed Patient",
      visitDate: details.examDate || new Date().toLocaleDateString("en-US"),
      clinician: activeClinician,
      submittedBy: details.submittedBy,
      procedure: details.tentativeDiagnosis?.find(Boolean) || "Comprehensive Oral Diagnosis & Examination",
      notes: details.historyOfPresentIllness || details.ciRemarks || "Digitized Oral Diagnosis Form",
      phone: details.cellPhone,
      email: details.email,
      sex: details.sex,
      birthDate: details.birthDate,
      age: details.age,
      homeAddress: details.homeAddress,
      odfDetails: details,
    });
  };

  const textField = (label, field, options = {}) => (
    <label className={`odf-field ${options.className || ""}`} key={field}>
      <span>{label}</span>
      <input
        type={options.type || "text"}
        value={form[field] ?? ""}
        onChange={(event) => updateField(field, event.target.value)}
        placeholder={options.placeholder || ""}
        readOnly={options.readOnly || false}
        required={options.required || false}
      />
    </label>
  );

  const detailField = (label, field, specifyField = `${field}Specify`) => (
    <label className="odf-field odf-field--detail" key={field}>
      <span>{label}</span>
      <select value={form[field] || "Normal"} onChange={(event) => updateField(field, event.target.value)}>
        <option>Normal</option>
        <option>Abnormal</option>
        <option>Not examined</option>
      </select>
      {form[field] === "Abnormal" && (
        <input
          aria-label={`${label} findings`}
          value={form[specifyField] || ""}
          onChange={(event) => updateField(specifyField, event.target.value)}
          placeholder="Specify findings"
        />
      )}
    </label>
  );

  return (
    <div className="odf-overlay" role="presentation">
      <form className="odf-sheet" onSubmit={handleSubmit} aria-label="Oral Diagnosis Form">
        <header className="odf-header">
          <h1>Centro Escolar University</h1>
          <h2>School of Dentistry</h2>
          <p>Manila * Malolos * Makati</p>
          <h3>Oral Diagnosis Form</h3>
        </header>

        <section className="odf-section" aria-labelledby="odf-patient-heading">
          <h4 id="odf-patient-heading">Patient Information</h4>
          <div className="odf-grid odf-grid--patient">
            {textField("Name", "name", { required: true })}
            {textField("Home Address", "homeAddress")}
            {textField("Birth Date", "birthDate", { type: "date" })}
            {textField("Age", "age", { type: "number" })}
            <label className="odf-field">
              <span>Sex</span>
              <select value={form.sex} onChange={(event) => updateField("sex", event.target.value)}>
                <option value="">Select</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </label>
            {textField("8-Digit Patient ID", "eightDigitId", { readOnly: true })}
            {textField("Cell Phone", "cellPhone", { type: "tel" })}
            {textField("Home Telephone", "homeTel", { type: "tel" })}
            {textField("Email", "email", { type: "email" })}
          </div>
        </section>

        <section className="odf-section" aria-labelledby="odf-history-heading">
          <h4 id="odf-history-heading">Case History</h4>
          <fieldset className="odf-fieldset">
            <legend>Chief Complaint(s)</legend>
            <div className="odf-grid odf-grid--complaints">
              {(form.chiefComplaints || []).map((complaint, index) => (
                <label className="odf-field" key={`complaint-${index}`}>
                  <span>Complaint {index + 1}</span>
                  <input
                    value={complaint}
                    onChange={(event) => updateListItem("chiefComplaints", index, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <label className="odf-field odf-field--block">
            <span>History of Present Illness</span>
            <textarea
              rows={3}
              value={form.historyOfPresentIllness}
              onChange={(event) => updateField("historyOfPresentIllness", event.target.value)}
            />
          </label>
        </section>

        <section className="odf-section" aria-labelledby="odf-medical-heading">
          <h4 id="odf-medical-heading">Past Medical History</h4>
          <fieldset className="odf-fieldset">
            <legend>Medical Conditions</legend>
            <div className="odf-checkbox-grid">
              {MEDICAL_CONDITIONS.map((condition) => (
                <label className="odf-checkbox" key={condition}>
                  <input
                    type="checkbox"
                    checked={(form.medicalConditions || []).includes(condition)}
                    onChange={() => toggleMedicalCondition(condition)}
                  />
                  {condition}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="odf-grid odf-grid--patient">
            {textField("Allergies / Specify", "allergySpecify")}
            {textField("Other Illnesses", "otherIllnesses")}
            {textField("Current Medications", "medications")}
            <label className="odf-field">
              <span>Previous Extraction</span>
              <select
                value={form.previousExtraction}
                onChange={(event) => updateField("previousExtraction", event.target.value)}
              >
                <option>No</option>
                <option>Yes</option>
              </select>
            </label>
            {form.previousExtraction === "Yes" && textField("When", "extractionWhen")}
          </div>
        </section>

        <section className="odf-section" aria-labelledby="odf-exam-heading">
          <h4 id="odf-exam-heading">Clinical Examination</h4>
          <div className="odf-grid odf-grid--exam">
            {detailField("Head", "head")}
            {detailField("Eyes", "eyes")}
            {detailField("TMJ", "tmj")}
            {detailField("Lip", "lip")}
            {detailField("Palate", "palate")}
            {detailField("Floor of Mouth", "floorOfMouth", "floorSpecify")}
            {detailField("Tongue", "tongue")}
            {detailField("Gingiva", "gingiva")}
            <label className="odf-field">
              <span>Deposits</span>
              <select value={form.deposits} onChange={(event) => updateField("deposits", event.target.value)}>
                <option>None</option>
                <option>Soft</option>
                <option>Calculus</option>
                <option>Soft and Calculus</option>
              </select>
            </label>
            <label className="odf-field">
              <span>Occlusion</span>
              <select value={form.occlusion} onChange={(event) => updateField("occlusion", event.target.value)}>
                <option>Class I</option>
                <option>Class II</option>
                <option>Class III</option>
                <option>Other</option>
              </select>
            </label>
          </div>
          <div className="odf-grid odf-grid--vitals">
            {textField("Blood Pressure", "bloodPressure")}
            {textField("Pulse Rate", "pulseRate")}
            {textField("Respiratory Rate", "respiratoryRate")}
            {textField("Temperature", "temperature")}
          </div>
          <label className="odf-field odf-field--block">
            <span>Other Oral Abnormalities</span>
            <textarea
              rows={2}
              value={form.otherOralAbnormalities}
              onChange={(event) => updateField("otherOralAbnormalities", event.target.value)}
            />
          </label>
        </section>

        <section className="odf-section" aria-labelledby="odf-diagnosis-heading">
          <h4 id="odf-diagnosis-heading">Diagnostic Findings and Plan</h4>
          <label className="odf-field odf-field--block">
            <span>Radiographic Interpretation</span>
            <textarea
              rows={2}
              value={form.radiographicInterpretation}
              onChange={(event) => updateField("radiographicInterpretation", event.target.value)}
            />
          </label>
          <div className="odf-grid odf-grid--plans">
            <fieldset className="odf-fieldset">
              <legend>Tentative Diagnosis</legend>
              {(form.tentativeDiagnosis || []).map((diagnosis, index) => (
                <input
                  className="odf-list-input"
                  key={`diagnosis-${index}`}
                  aria-label={`Tentative diagnosis ${index + 1}`}
                  value={diagnosis}
                  onChange={(event) => updateListItem("tentativeDiagnosis", index, event.target.value)}
                  placeholder={`Diagnosis ${index + 1}`}
                />
              ))}
            </fieldset>
            <fieldset className="odf-fieldset">
              <legend>Recommended Treatment Plan</legend>
              {(form.recommendedTreatmentPlan || []).map((treatment, index) => (
                <input
                  className="odf-list-input"
                  key={`treatment-${index}`}
                  aria-label={`Recommended treatment ${index + 1}`}
                  value={treatment}
                  onChange={(event) => updateListItem("recommendedTreatmentPlan", index, event.target.value)}
                  placeholder={`Treatment ${index + 1}`}
                />
              ))}
            </fieldset>
          </div>
          <label className="odf-field odf-field--block">
            <span>CI Remarks</span>
            <textarea
              rows={2}
              value={form.ciRemarks}
              onChange={(event) => updateField("ciRemarks", event.target.value)}
            />
          </label>
          <div className="odf-grid odf-grid--vitals">
            {textField("Examined By", "examinedBy")}
            {textField("Examination Date", "examDate", { type: "date" })}
            {textField("Clinic Level", "clinicLevel")}
            {textField("Clinician", "clinician")}
          </div>
        </section>

        <footer className="odf-actions">
          <p>Review all information before submitting this form.</p>
          <div>
            <button type="button" className="odf-button odf-button--cancel" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="odf-button odf-button--save">
              Save Oral Diagnosis Form
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
