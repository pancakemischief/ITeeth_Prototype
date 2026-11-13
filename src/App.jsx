import { useState, useEffect, useCallback } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Login from "./components/Login";
import PatientRecord from "./components/PatientRecord";
import PendingApproval from "./components/PendingApproval";
import Settings from "./components/Settings";
import PatientRecordsHistoryModal from "./components/PatientRecordsHistoryModal";
import OralDiagnosisForm from "./components/OralDiagnosisForm";
import DocumentViewerModal from "./components/DocumentViewerModal";
import { canApproveODF, canDeleteRecords } from "./lib/roleUtils";
import {
  fetchPatientsFromSupabase,
  fetchPendingFromSupabase,
  savePatientToSupabase,
  savePendingToSupabase,
  approvePendingInSupabase,
  declinePendingInSupabase,
  deleteSelectedPatientRecords,
  deleteEntirePatient,
  to8DigitId,
  DEFAULT_CLINICIAN,
  getLocalPatients,
  getLocalPending,
} from "./lib/dentalService";

function toIsoDateInput(val) {
  if (!val) return "";
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const slashMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, "0");
    const d = slashMatch[2].padStart(2, "0");
    const y = slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3];
    return `${y}-${m}-${d}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }
  return "";
}

function buildOdfInitialDataFromRecord(patient, record) {
  const pOdf = patient?.odfData || {};
  const rOdf = record?.odfDetails || {};
  const merged = { ...pOdf, ...rOdf };
  const numericId = to8DigitId(patient?.id || patient?.eightDigitId || merged.eightDigitId);
  const recordDate = record?.date || rOdf.date || patient?.lastVisit || "";
  const rawToothDigits = record?.toothNo ? String(record.toothNo).replace(/[^\d]/g, "") : "";
  const fallbackTeeth =
    rawToothDigits && !rOdf.teethFindings
      ? { [rawToothDigits]: record?.diagnosis || record?.title || "Recorded" }
      : undefined;

  const hasRecordTreatmentRows =
    (Array.isArray(rOdf.treatmentLogRows) && rOdf.treatmentLogRows.some((r) => r.leftDate || r.leftCasesApproved || r.rightDate || r.rightCasesApproved)) ||
    (Array.isArray(rOdf.treatmentLog) && rOdf.treatmentLog.length > 0);

  const fallbackTreatmentLog = !hasRecordTreatmentRows && record
    ? [
        {
          date: recordDate,
          casesApproved: record.title || patient?.procedure || "",
          toothNo: record.toothNo || "",
          ciSign: record.clinician || patient?.clinician || "",
        },
      ]
    : rOdf.treatmentLog || pOdf.treatmentLog || [];

  const isOdfRec = record?.type === "odf";

  return {
    ...merged,
    eightDigitId: numericId,
    name: rOdf.name || patient?.name || pOdf.name || "",
    visitDate: recordDate,
    homeAddress: rOdf.homeAddress || patient?.homeAddress || pOdf.homeAddress || "",
    birthDate: rOdf.birthDate || pOdf.birthDate || patient?.dateOfBirth || "",
    age: rOdf.age || pOdf.age || patient?.age || "",
    sex: rOdf.sex || pOdf.sex || patient?.gender || "",
    height: rOdf.height || pOdf.height || patient?.height || "",
    weight: rOdf.weight || pOdf.weight || patient?.weight || "",
    civilStatus: rOdf.civilStatus || pOdf.civilStatus || patient?.civilStatus || "",
    homeTel: rOdf.homeTel || pOdf.homeTel || patient?.homeTel || "",
    cellPhone: rOdf.cellPhone || patient?.phone || pOdf.cellPhone || "",
    nationality: rOdf.nationality || pOdf.nationality || patient?.nationality || "Filipino",
    occupation: rOdf.occupation || pOdf.occupation || patient?.occupation || "",
    religion: rOdf.religion || pOdf.religion || patient?.religion || "",
    chiefComplaints:
      Array.isArray(rOdf.chiefComplaints) && rOdf.chiefComplaints.some(Boolean)
        ? rOdf.chiefComplaints
        : [
            record?.title || patient?.procedure || "",
            record?.summary || "",
            "",
            "",
          ],
    historyOfPresentIllness:
      rOdf.historyOfPresentIllness ||
      record?.notes ||
      record?.summary ||
      (isOdfRec ? pOdf.historyOfPresentIllness : "") ||
      patient?.notes ||
      "",
    tentativeDiagnosis:
      Array.isArray(rOdf.tentativeDiagnosis) && rOdf.tentativeDiagnosis.some(Boolean)
        ? rOdf.tentativeDiagnosis
        : record?.diagnosis
        ? [record.diagnosis]
        : record?.title
        ? [record.title]
        : isOdfRec && Array.isArray(pOdf.tentativeDiagnosis)
        ? pOdf.tentativeDiagnosis
        : [""],
    recommendedTreatmentPlan:
      Array.isArray(rOdf.recommendedTreatmentPlan) && rOdf.recommendedTreatmentPlan.some(Boolean)
        ? rOdf.recommendedTreatmentPlan
        : record?.title
        ? [record.title]
        : isOdfRec && Array.isArray(pOdf.recommendedTreatmentPlan)
        ? pOdf.recommendedTreatmentPlan
        : [""],
    examinedBy: rOdf.examinedBy || record?.clinician || patient?.clinician || DEFAULT_CLINICIAN,
    examDate: toIsoDateInput(rOdf.examDate || recordDate),
    clinicLevel: rOdf.clinicLevel || pOdf.clinicLevel || "",
    treatmentLogRows: hasRecordTreatmentRows && Array.isArray(rOdf.treatmentLogRows) ? rOdf.treatmentLogRows : undefined,
    treatmentLog: fallbackTreatmentLog,
    ciRemarks: rOdf.ciRemarks || record?.notes || (isOdfRec ? pOdf.ciRemarks : "") || "",
    consentPatientName: rOdf.consentPatientName || pOdf.consentPatientName || patient?.name || "",
    consentHomeAddress: rOdf.consentHomeAddress || patient?.homeAddress || pOdf.homeAddress || "",
    consentDate: toIsoDateInput(rOdf.consentDate || recordDate),
    consentClinicianName: rOdf.consentClinicianName || record?.clinician || patient?.clinician || DEFAULT_CLINICIAN,
    consentClinicianDate: toIsoDateInput(rOdf.consentClinicianDate || rOdf.consentDate || recordDate),
    teethFindings: rOdf.teethFindings || fallbackTeeth || (isOdfRec ? pOdf.teethFindings : undefined) || {},
    rawScanUrl: record?.rawScanUrl || rOdf.rawScanUrl || (isOdfRec ? pOdf.rawScanUrl || patient?.latestOdfScanUrl : null) || null,
    rawScanPage2Url: record?.rawScanPage2Url || rOdf.rawScanPage2Url || (isOdfRec ? pOdf.rawScanPage2Url || patient?.latestOdfPage2Url : null) || null,
    odontogramCropUrl: record?.odontogramCropUrl || rOdf.odontogramCropUrl || (isOdfRec ? pOdf.odontogramCropUrl : null) || null,
    consentCropUrl: record?.consentCropUrl || rOdf.consentCropUrl || (isOdfRec ? pOdf.consentCropUrl : null) || null,
    clinician: record?.clinician || rOdf.clinician || patient?.clinician || DEFAULT_CLINICIAN,
  };
}

function AppRoutes() {
  const navigate = useNavigate();

  // Authentication State
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = sessionStorage.getItem("iteeth_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [patients, setPatients] = useState(() => getLocalPatients());
  const [pending, setPending] = useState(() => getLocalPending());
  const [historyTarget, setHistoryTarget] = useState(null); // { patient, initialRecord }
  const [viewRecordTarget, setViewRecordTarget] = useState(null); // { patient, record } -> Full 2-page ODF view
  const [odfModalTarget, setOdfModalTarget] = useState(null); // patient object to open ODF for
  const [activeReviewModal, setActiveReviewModal] = useState(null); // pending item to review
  const [reviewDocModalTarget, setReviewDocModalTarget] = useState(null); // item to inspect document scan for
  const [notification, setNotification] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const showToast = (message) => {
    setNotification(message);
    setTimeout(() => {
      setNotification((current) => (current === message ? null : current));
    }, 4500);
  };

  // Load from Supabase on mount
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [patientsRes, pendingRes] = await Promise.all([
          fetchPatientsFromSupabase(),
          fetchPendingFromSupabase(),
        ]);
        if (!active) return;
        if (patientsRes.data && patientsRes.data.length > 0) {
          setPatients(patientsRes.data);
        }
        if (pendingRes.data && pendingRes.data.length > 0) {
          setPending(pendingRes.data);
        }
      } catch (err) {
        console.warn("Initial Supabase load error:", err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const refreshFromSupabase = useCallback(async (showNotice = true) => {
    setIsSyncing(true);
    try {
      const [patientsRes, pendingRes] = await Promise.all([
        fetchPatientsFromSupabase(),
        fetchPendingFromSupabase(),
      ]);

      let loadedCount = 0;
      if (patientsRes.data && patientsRes.data.length > 0) {
        setPatients(patientsRes.data);
        loadedCount += patientsRes.data.length;
      }

      if (pendingRes.data && pendingRes.data.length > 0) {
        setPending(pendingRes.data);
        loadedCount += pendingRes.data.length;
      }

      if (showNotice) {
        if (patientsRes.success && loadedCount > 0) {
          showToast(`✓ Synchronized ${loadedCount} patient records with Supabase`);
        } else if (!patientsRes.success) {
          showToast(`⚡ Using cached records (${patientsRes.error || "Supabase RLS active"})`);
        } else {
          showToast(`✓ Synced with Supabase (${loadedCount} records)`);
        }
      }
    } catch (err) {
      console.warn("Failed fetching from Supabase:", err);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const handleLogin = (user) => {
    setCurrentUser(user);
    try {
      sessionStorage.setItem("iteeth_user", JSON.stringify(user));
    } catch {
      // ignore
    }
    showToast(`✓ Welcome, ${user.role} (${user.email})`);
    navigate("/patients");
  };

  const handleSignOut = () => {
    setCurrentUser(null);
    try {
      sessionStorage.removeItem("iteeth_user");
    } catch {
      // ignore
    }
    navigate("/login");
  };

  const handleSwitchRole = (newRole) => {
    const updated = {
      ...currentUser,
      role: newRole,
      employeeId: newRole.includes("Faculty") ? "FAC-2026-081" : newRole.includes("Admin") ? "ADM-2026-001" : null,
    };
    setCurrentUser(updated);
    try {
      sessionStorage.setItem("iteeth_user", JSON.stringify(updated));
    } catch {
      // ignore
    }
    showToast(`Role switched to: ${newRole}`);
  };

  const handleNavigate = (key) => {
    if (key === "patients") navigate("/patients");
    else if (key === "approvals") navigate("/approvals");
    else if (key === "settings") navigate("/settings");
    else navigate(`/${key}`);
  };

  // Open full 2-page digital form when clicking "View Record" on a record row, or fallback history modal
  const handleViewRecords = (patient, initialRecord = null) => {
    if (initialRecord) {
      setViewRecordTarget({ patient, record: initialRecord });
      return;
    }
    setHistoryTarget({ patient, initialRecord: null });
  };

  // Delete selected history records for a patient (Faculty & System Admin only)
  const handleDeleteSelectedRecords = async (patient, recordsToDelete = []) => {
    if (!canDeleteRecords(currentUser?.role)) {
      showToast("❌ Permission Denied: Only Dentistry Department Faculty and System Administrators can delete records.");
      return { success: false };
    }
    if (!patient || !recordsToDelete.length) return { success: false };

    const res = await deleteSelectedPatientRecords(patient, recordsToDelete);
    const deletedSet = new Set(res.deletedIds || []);
    const numericId = to8DigitId(patient.id || patient.eightDigitId);

    setPending((prev) =>
      prev.filter((p) => {
        const subId = p.submissionId || `pending_${to8DigitId(p.eightDigitId || p.id)}_${p.visitDate || ""}`;
        return !deletedSet.has(subId) && !deletedSet.has(p.submissionId);
      })
    );

    if (
      viewRecordTarget &&
      to8DigitId(viewRecordTarget.patient?.id) === numericId &&
      deletedSet.has(viewRecordTarget.record?.id)
    ) {
      setViewRecordTarget(null);
    }

    showToast(
      `✓ Deleted ${recordsToDelete.length} selected record${recordsToDelete.length > 1 ? "s" : ""} for ${patient.name}.`
    );
    return res;
  };

  // Delete an entire patient record + history (Faculty & System Admin only)
  const handleDeletePatient = async (patient) => {
    if (!canDeleteRecords(currentUser?.role)) {
      showToast("❌ Permission Denied: Only Dentistry Department Faculty and System Administrators can delete patient records.");
      return { success: false };
    }
    if (!patient) return { success: false };
    const numericId = to8DigitId(patient.id || patient.eightDigitId);

    await deleteEntirePatient(patient);

    setPatients((prev) => prev.filter((p) => to8DigitId(p.eightDigitId || p.id) !== numericId));
    setPending((prev) => prev.filter((p) => to8DigitId(p.eightDigitId || p.id) !== numericId));
    if (historyTarget && to8DigitId(historyTarget.patient?.id) === numericId) {
      setHistoryTarget(null);
    }
    if (viewRecordTarget && to8DigitId(viewRecordTarget.patient?.id) === numericId) {
      setViewRecordTarget(null);
    }

    showToast(`✓ Deleted patient record #${numericId} (${patient.name}).`);
    return { success: true };
  };

  // Open review modal for pending item
  const handleReview = (pendingItem) => {
    setActiveReviewModal(pendingItem);
  };

  // Submit Oral Diagnosis Form (ODF) or pending approval
  const handleUploadODF = async (odfItem) => {
    const formattedId = to8DigitId(odfItem.id || odfItem.eightDigitId);
    const submissionId = odfItem.submissionId || `sub_${formattedId}_${Date.now()}`;
    const formattedPending = {
      ...odfItem,
      id: formattedId,
      eightDigitId: formattedId,
      submissionId,
      clinician: odfItem.clinician || DEFAULT_CLINICIAN,
    };

    // 1. Update pending state (match by submissionId so multiple submissions for same patient don't collide)
    setPending((prev) => [
      formattedPending,
      ...prev.filter((p) => (p.submissionId || to8DigitId(p.id)) !== submissionId),
    ]);

    // 2. Update or register patient in patients table while preserving existing metadata/dbId
    let savedPatientName = formattedPending.name || "Patient #" + formattedId;
    setPatients((prev) => {
      const existing = prev.find((p) => to8DigitId(p.id) === formattedId);
      const patientEntry = {
        ...(existing || {}),
        id: formattedId,
        eightDigitId: formattedId,
        name: existing?.name || formattedPending.name || "Patient #" + formattedId,
        lastVisit: formattedPending.visitDate || existing?.lastVisit || new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
        clinician: formattedPending.clinician || existing?.clinician,
        procedure: formattedPending.procedure || existing?.procedure || "Oral Diagnosis Form (ODF)",
        notes: formattedPending.notes || existing?.notes || "",
        phone: odfItem.odfDetails?.cellPhone || odfItem.cellPhone || existing?.phone || "",
        email: odfItem.odfDetails?.email || odfItem.email || existing?.email || "",
        gender: odfItem.odfDetails?.sex || odfItem.sex || existing?.gender || "Male",
        dateOfBirth: odfItem.odfDetails?.birthDate || odfItem.birthDate || existing?.dateOfBirth || "",
        age: odfItem.odfDetails?.age || odfItem.age || existing?.age || "",
        homeAddress: odfItem.odfDetails?.homeAddress || odfItem.homeAddress || existing?.homeAddress || "",
        odfData: {
          ...(existing?.odfData || {}),
          ...(odfItem.odfDetails || odfItem),
        },
      };
      savedPatientName = patientEntry.name;
      return [
        patientEntry,
        ...prev.filter((p) => to8DigitId(p.id) !== formattedId),
      ];
    });

    showToast(`Submitting ODF for Patient #${formattedId} (${savedPatientName})...`);

    const res = await savePendingToSupabase(formattedPending);
    if (res.success) {
      showToast(`✓ ODF #${formattedId} saved & added to patient record history!`);
    } else {
      showToast(`✓ ODF #${formattedId} saved to patient record history (${res.error || "persisted in local cache"})`);
    }
  };

  // Approve a pending request
  const handleApprove = async (item) => {
    if (!canApproveODF(currentUser?.role)) {
      showToast("❌ Permission Denied: Student Clinicians cannot approve ODF submissions. Only Faculty and System Administrators can approve.");
      return;
    }
    const formattedId = to8DigitId(item.id);
    const targetSubId = item.submissionId;

    setPending((prev) =>
      prev.filter((p) => {
        if (targetSubId && p.submissionId) return p.submissionId !== targetSubId;
        return to8DigitId(p.id) !== formattedId;
      })
    );

    setPatients((prev) => {
      const existing = prev.find((p) => to8DigitId(p.id) === formattedId);
      const approvedPatient = {
        ...(existing || {}),
        id: formattedId,
        eightDigitId: formattedId,
        name: existing?.name || item.name,
        lastVisit: item.visitDate || existing?.lastVisit || new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
        clinician: item.clinician || existing?.clinician || DEFAULT_CLINICIAN,
        procedure: item.procedure || existing?.procedure,
        notes: item.notes || existing?.notes,
        odfData: {
          ...(existing?.odfData || {}),
          ...(item.odfDetails || {}),
        },
      };
      return [
        approvedPatient,
        ...prev.filter((p) => to8DigitId(p.id) !== formattedId),
      ];
    });

    setActiveReviewModal(null);
    showToast(`✓ Approved #${formattedId} (${item.name}). Syncing with Supabase...`);

    const res = await approvePendingInSupabase(item);
    if (res.success) {
      if (res.data) {
        setPatients((prev) => [
          res.data,
          ...prev.filter((p) => to8DigitId(p.id) !== formattedId && p.id !== res.data.id),
        ]);
      }
      showToast(`✓ Successfully approved & added to #${formattedId} record history!`);
    } else {
      showToast(`✓ Approved & saved to patient history (${res.error || "persisted locally"})`);
    }
  };

  // Decline a pending request
  const handleDecline = async (item) => {
    if (!canApproveODF(currentUser?.role)) {
      showToast("❌ Permission Denied: Student Clinicians cannot decline ODF submissions.");
      return;
    }
    const formattedId = to8DigitId(item.id);
    const targetSubId = item.submissionId;

    setPending((prev) =>
      prev.filter((p) => {
        if (targetSubId && p.submissionId) return p.submissionId !== targetSubId;
        return to8DigitId(p.id) !== formattedId;
      })
    );
    setActiveReviewModal(null);
    showToast(`Declining #${formattedId} (${item.name})...`);

    const res = await declinePendingInSupabase(item);
    if (res.success) {
      showToast(`✕ Declined request for #${formattedId} in Supabase.`);
    } else {
      showToast(`✕ Declined request.`);
    }
  };

  // Seed sample records into Supabase
  const handleSeedSupabase = async () => {
    showToast("Seeding 8-digit sample data to Supabase...");
    let savedPatients = 0;
    let savedPending = 0;

    for (const p of patients) {
      const res = await savePatientToSupabase(p);
      if (res.success) savedPatients++;
    }

    for (const pend of pending) {
      const res = await savePendingToSupabase(pend);
      if (res.success) savedPending++;
    }

    if (savedPatients > 0 || savedPending > 0) {
      showToast(`✓ Seeded ${savedPatients} patients and ${savedPending} pending requests!`);
    } else {
      showToast("⚡ Tables protected by RLS. Apply RLS script from Settings in Supabase SQL editor.");
    }
  };

  // Protected route wrapper
  if (!currentUser) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <>
      {notification && (
        <div
          role="status"
          style={{
            position: "fixed",
            top: 14,
            right: 14,
            zIndex: 9999,
            background: "#0f172a",
            color: "#ffffff",
            padding: "11px 18px",
            borderRadius: "12px",
            fontSize: "13px",
            fontWeight: 600,
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            border: "1px solid rgba(255,255,255,0.15)",
          }}
        >
          {notification}
        </div>
      )}

      <Routes>
        <Route path="/login" element={<Login onLogin={handleLogin} />} />
        <Route path="/" element={<Navigate to="/patients" replace />} />
        <Route
          path="/patients"
          element={
            <PatientRecord
              patients={patients}
              pending={pending}
              onNavigate={handleNavigate}
              onViewRecords={handleViewRecords}
              onDeleteSelectedRecords={handleDeleteSelectedRecords}
              onDeletePatient={handleDeletePatient}
              onUploadODF={handleUploadODF}
              isSyncing={isSyncing}
              currentUser={currentUser}
              onSignOut={handleSignOut}
            />
          }
        />
        <Route
          path="/approvals"
          element={
            <PendingApproval
              pending={pending}
              patients={patients}
              onNavigate={handleNavigate}
              onReview={handleReview}
              onApprove={handleApprove}
              onDecline={handleDecline}
              onAddPending={handleUploadODF}
              isSyncing={isSyncing}
              currentUser={currentUser}
              onSignOut={handleSignOut}
            />
          }
        />
        <Route
          path="/settings"
          element={
            <Settings
              onNavigate={handleNavigate}
              onSeedSupabase={handleSeedSupabase}
              onRefreshFromSupabase={() => refreshFromSupabase(true)}
              currentUser={currentUser}
              onSignOut={handleSignOut}
              onSwitchRole={handleSwitchRole}
            />
          }
        />
        <Route path="*" element={<Navigate to="/patients" replace />} />
      </Routes>

      {/* Patient Record History Modal: List of clickable historical records or specific visit details */}
      {historyTarget && (
        <PatientRecordsHistoryModal
          patient={historyTarget.patient}
          initialSelectedRecord={historyTarget.initialRecord}
          onClose={() => setHistoryTarget(null)}
          onOpenOdf={(p) => {
            setHistoryTarget(null);
            setOdfModalTarget(p);
          }}
          currentUser={currentUser}
        />
      )}

      {/* Full 2-Page Digital ODF Viewer when clicking "View Record" on Selected Patient page (All Roles) */}
      {viewRecordTarget && (
        <OralDiagnosisForm
          key={`view-${to8DigitId(viewRecordTarget.patient?.id)}-${viewRecordTarget.record?.id || "rec"}`}
          patientId={to8DigitId(viewRecordTarget.patient?.id || viewRecordTarget.patient?.eightDigitId)}
          patients={patients}
          pending={pending}
          readOnly={true}
          initialData={buildOdfInitialDataFromRecord(viewRecordTarget.patient, viewRecordTarget.record)}
          currentUser={currentUser}
          onCancel={() => setViewRecordTarget(null)}
        />
      )}

      {/* Digital ODF Modal opened directly from History Modal or action */}
      {odfModalTarget && (
        <OralDiagnosisForm
          patientId={to8DigitId(odfModalTarget.id || odfModalTarget.eightDigitId)}
          patients={patients}
          pending={pending}
          initialData={{
            ...(odfModalTarget.odfData || {}),
            eightDigitId: to8DigitId(odfModalTarget.id || odfModalTarget.eightDigitId),
            name: odfModalTarget.name || "",
            cellPhone: odfModalTarget.phone || "",
            homeAddress: odfModalTarget.homeAddress || "",
            historyOfPresentIllness: odfModalTarget.notes || "",
            sex: odfModalTarget.gender || "Male",
            age: odfModalTarget.age || "",
            birthDate: odfModalTarget.dateOfBirth || "",
            clinician: odfModalTarget.clinician || DEFAULT_CLINICIAN,
          }}
          currentUser={currentUser}
          onCancel={() => setOdfModalTarget(null)}
          onSave={(odfData) => {
            handleUploadODF(odfData);
            setOdfModalTarget(null);
          }}
        />
      )}

      {/* Faculty Review Modal for Pending Approvals */}
      {activeReviewModal && (() => {
        const allowApprove = canApproveODF(currentUser?.role);
        return (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.55)",
              backdropFilter: "blur(4px)",
              zIndex: 1000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
            }}
            onClick={() => setActiveReviewModal(null)}
          >
            <div
              style={{
                width: "100%",
                maxWidth: "540px",
                background: "#ffffff",
                borderRadius: "24px",
                boxShadow: "0 24px 48px -12px rgba(0, 0, 0, 0.25)",
                overflow: "hidden",
                border: "1px solid #e2e8f0",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  background: "linear-gradient(135deg, #e91e77 0%, #f02a80 100%)",
                  padding: "22px 24px",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "20px" }}>📋</span>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "17px", fontWeight: "800" }}>
                      {allowApprove ? "Review Oral Diagnosis Form (ODF)" : "View Submitted ODF Request"}
                    </h3>
                    <p style={{ margin: 0, fontSize: "11px", opacity: 0.9 }}>
                      {allowApprove ? "Supervising Faculty Sign-Off Gate" : "Student Clinician Submission View (Pending Approval)"}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveReviewModal(null)}
                  style={{
                    background: "rgba(255, 255, 255, 0.2)",
                    border: "none",
                    borderRadius: "50%",
                    width: "30px",
                    height: "30px",
                    color: "#fff",
                    fontSize: "14px",
                    fontWeight: "700",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ padding: "22px 24px" }}>
                {!allowApprove && (
                  <div
                    style={{
                      background: "#fdf2f8",
                      border: "1px solid #fbcfe8",
                      borderRadius: "10px",
                      padding: "10px 14px",
                      marginBottom: "14px",
                      fontSize: "12px",
                      color: "#9d174d",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>🔒 <strong>Student Clinician View:</strong> You can view your submitted details and attached scans. Only Supervising Faculty and System Administrators can approve or decline ODF requests.</span>
                  </div>
                )}

                <div
                  style={{
                    fontSize: "13px",
                    lineHeight: "1.7",
                    color: "#1e293b",
                    background: "#f8fafc",
                    padding: "16px",
                    borderRadius: "14px",
                    border: "1px solid #e2e8f0",
                    marginBottom: "20px",
                  }}
                >
                  <p style={{ margin: "3px 0" }}>
                    <strong style={{ color: "#475569" }}>Patient ID:</strong>{" "}
                    <code style={{ background: "#fff", padding: "2px 8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontWeight: "700", color: "#0f172a" }}>
                      {to8DigitId(activeReviewModal.id)}
                    </code>
                  </p>
                  <p style={{ margin: "3px 0" }}>
                    <strong style={{ color: "#475569" }}>Patient Name:</strong> {activeReviewModal.name}
                  </p>
                  <p style={{ margin: "3px 0" }}>
                    <strong style={{ color: "#475569" }}>Visit Date:</strong> {activeReviewModal.visitDate}
                  </p>
                  <p style={{ margin: "3px 0" }}>
                    <strong style={{ color: "#475569" }}>Attending Clinician:</strong> {activeReviewModal.clinician || DEFAULT_CLINICIAN}
                  </p>
                  <p style={{ margin: "3px 0" }}>
                    <strong style={{ color: "#475569" }}>Proposed Procedure:</strong> {activeReviewModal.procedure}
                  </p>
                  {activeReviewModal.notes && (
                    <p style={{ margin: "3px 0" }}>
                      <strong style={{ color: "#475569" }}>Clinical Notes:</strong> {activeReviewModal.notes}
                    </p>
                  )}

                  {/* Show thumbnail if Odontogram crop exists */}
                  {(activeReviewModal.odontogramCropUrl || activeReviewModal.odfDetails?.odontogramCropUrl) && (
                    <div style={{ marginTop: "10px", textAlign: "center" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "#e91e77", display: "block", marginBottom: "4px" }}>
                        Attached Odontogram Scan:
                      </span>
                      <img
                        src={activeReviewModal.odontogramCropUrl || activeReviewModal.odfDetails?.odontogramCropUrl}
                        alt="Odontogram preview"
                        style={{ maxHeight: "140px", maxWidth: "100%", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                      />
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={() => setReviewDocModalTarget(activeReviewModal)}
                    style={{
                      background: "#f1f5f9",
                      border: "1.5px solid #cbd5e1",
                      color: "#0f172a",
                      padding: "9px 16px",
                      borderRadius: "12px",
                      fontWeight: "700",
                      cursor: "pointer",
                      fontSize: "13px",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>📄 View Scanned Document</span>
                  </button>

                  <div style={{ display: "flex", gap: "10px" }}>
                    {allowApprove ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDecline(activeReviewModal)}
                          style={{
                            background: "#fef2f2",
                            color: "#dc2626",
                            border: "1.5px solid #fecaca",
                            padding: "9px 18px",
                            borderRadius: "12px",
                            fontWeight: "700",
                            cursor: "pointer",
                            fontSize: "13px",
                          }}
                        >
                          Decline Request
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApprove(activeReviewModal)}
                          style={{
                            background: "linear-gradient(135deg, #e91e77 0%, #ec206f 100%)",
                            color: "#ffffff",
                            border: "none",
                            padding: "9px 20px",
                            borderRadius: "12px",
                            fontWeight: "700",
                            cursor: "pointer",
                            fontSize: "13px",
                            boxShadow: "0 4px 12px rgba(233, 30, 119, 0.3)",
                          }}
                        >
                          Faculty Approve
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActiveReviewModal(null)}
                        style={{
                          background: "#0f172a",
                          color: "#ffffff",
                          border: "none",
                          padding: "9px 22px",
                          borderRadius: "12px",
                          fontWeight: "700",
                          cursor: "pointer",
                          fontSize: "13px",
                        }}
                      >
                        Close
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Scanned Document Viewer from Review Modal */}
      {reviewDocModalTarget && (
        <DocumentViewerModal
          record={reviewDocModalTarget}
          patient={reviewDocModalTarget}
          onClose={() => setReviewDocModalTarget(null)}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
