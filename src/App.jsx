import { useState, useEffect, useCallback, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Login from "./components/Login";
import PatientRecord from "./components/PatientRecord";
import PendingApproval from "./components/PendingApproval";
import Settings from "./components/Settings";
import PatientRecordsHistoryModal from "./components/PatientRecordsHistoryModal";
import OralDiagnosisForm from "./components/OralDiagnosisForm";
import DocumentViewerModal from "./components/DocumentViewerModal";
import { canApproveODF, canDeleteRecords } from "./lib/roleUtils";
import { supabase } from "./lib/supabaseClient";
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
  DEFAULT_PATIENTS,
  DEFAULT_PENDING,
  clearAllLocalPhi,
  resolveOdfScanSignedUrl,
} from "./lib/dentalService";

function mapProfileRoleToDisplay(dbRole) {
  switch (String(dbRole || "").toLowerCase().trim()) {
    case "student_clinician":
      return "Student Clinician";
    case "faculty":
      return "Faculty";
    case "system_admin":
    case "admin":
      return "System Admin";
    case "patient":
      return "Patient";
    default:
      return null;
  }
}

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

  // Supabase Authentication & Profile State
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const authReqSeqRef = useRef(0);

  const [patients, setPatients] = useState([]);
  const [pending, setPending] = useState([]);
  const [historyTarget, setHistoryTarget] = useState(null); // { patient, initialRecord }
  const [viewRecordTarget, setViewRecordTarget] = useState(null); // { patient, record } -> Full 2-page ODF view
  const [odfModalTarget, setOdfModalTarget] = useState(null); // patient object to open ODF for
  const [activeReviewModal, setActiveReviewModal] = useState(null); // pending item to review
  const [reviewDocModalTarget, setReviewDocModalTarget] = useState(null); // item to inspect document scan for
  const [resolvedReviewScan, setResolvedReviewScan] = useState({ path: null, url: null });
  const [notification, setNotification] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const showToast = useCallback((message) => {
    setNotification(message);
    setTimeout(() => {
      setNotification((current) => (current === message ? null : current));
    }, 4500);
  }, []);

  const clearSessionPhiState = useCallback(() => {
    clearAllLocalPhi();
    setPatients([]);
    setPending([]);
    setHistoryTarget(null);
    setViewRecordTarget(null);
    setOdfModalTarget(null);
    setActiveReviewModal(null);
    setReviewDocModalTarget(null);
    setResolvedReviewScan({ path: null, url: null });
  }, []);

  // Resolve active Supabase session + server-side public.profiles row
  useEffect(() => {
    let mounted = true;

    const resolveSessionAndProfile = async (session, { isSignInEvent = false } = {}) => {
      const reqId = ++authReqSeqRef.current;

      if (!session?.user?.id) {
        if (!mounted || reqId !== authReqSeqRef.current) return;
        clearSessionPhiState();
        setCurrentUser(null);
        setAuthLoading(false);
        return;
      }

      try {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, email, full_name, employee_id, role, status")
          .eq("id", session.user.id)
          .single();

        if (!mounted || reqId !== authReqSeqRef.current) return;

        const normalizedRole = mapProfileRoleToDisplay(profile?.role);

        if (profileError || !profile || profile.status !== "approved" || !normalizedRole) {
          const accessDeniedMessage =
            profile?.status === "pending"
              ? "Your account is pending approval by an administrator."
              : profile?.status && profile.status !== "approved"
              ? "Access denied. Your account has not been approved."
              : "Unable to verify your user profile. Please contact an administrator.";

          clearSessionPhiState();
          setCurrentUser(null);
          setAuthError(accessDeniedMessage);
          setAuthLoading(false);
          await supabase.auth.signOut();
          return;
        }

        const normalizedUser = {
          id: profile.id,
          email: profile.email || session.user.email || "",
          name: profile.full_name || "",
          employeeId: profile.employee_id || null,
          role: normalizedRole,
        };

        setCurrentUser(normalizedUser);
        setAuthError("");
        setAuthLoading(false);

        if (isSignInEvent) {
          showToast(`✓ Welcome, ${normalizedUser.name || normalizedUser.role}`);
        }
      } catch {
        if (!mounted || reqId !== authReqSeqRef.current) return;
        clearSessionPhiState();
        setCurrentUser(null);
        setAuthError("Unable to verify your session profile. Please sign in again.");
        setAuthLoading(false);
        await supabase.auth.signOut();
      }
    };

    // Initial session resolution
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          clearSessionPhiState();
          setCurrentUser(null);
          setAuthLoading(false);
          return;
        }
        resolveSessionAndProfile(data?.session || null);
      })
      .catch(() => {
        if (mounted) {
          clearSessionPhiState();
          setCurrentUser(null);
          setAuthLoading(false);
        }
      });

    // Subscribe to auth state changes
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT" || !session) {
        authReqSeqRef.current += 1;
        clearSessionPhiState();
        setCurrentUser(null);
        setAuthLoading(false);
        if (event !== "SIGNED_OUT") {
          supabase.auth.signOut().catch(() => {});
        }
        return;
      }
      resolveSessionAndProfile(session, { isSignInEvent: event === "SIGNED_IN" });
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [showToast, clearSessionPhiState]);

  // Automatic 15-minute inactivity timeout while authenticated
  useEffect(() => {
    if (!currentUser?.id) return;

    const IDLE_TIMEOUT_MS = 900000;
    let idleTimerId = null;

    const handleIdleSignOut = async () => {
      clearSessionPhiState();
      setCurrentUser(null);
      setAuthError("Session expired due to inactivity. Please sign in again.");
      try {
        await supabase.auth.signOut();
      } catch {
        // ignore signOut errors during idle expiration
      }
      navigate("/login", { replace: true });
    };

    const resetIdleTimer = () => {
      if (idleTimerId) clearTimeout(idleTimerId);
      idleTimerId = setTimeout(handleIdleSignOut, IDLE_TIMEOUT_MS);
    };

    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    activityEvents.forEach((evt) => {
      window.addEventListener(evt, resetIdleTimer, { passive: true });
    });
    resetIdleTimer();

    return () => {
      if (idleTimerId) clearTimeout(idleTimerId);
      activityEvents.forEach((evt) => {
        window.removeEventListener(evt, resetIdleTimer);
      });
    };
  }, [currentUser?.id, clearSessionPhiState, navigate]);

  const activeReviewOdontogramPath =
    activeReviewModal?.odontogramCropUrl ||
    activeReviewModal?.odfDetails?.odontogramCropUrl ||
    null;

  // Resolve short-lived signed URL for review modal odontogram thumbnail
  useEffect(() => {
    if (!activeReviewOdontogramPath) return;

    let active = true;
    resolveOdfScanSignedUrl(activeReviewOdontogramPath).then((signedUrl) => {
      if (active) setResolvedReviewScan({ path: activeReviewOdontogramPath, url: signedUrl });
    });

    return () => {
      active = false;
    };
  }, [activeReviewOdontogramPath]);

  const isResolvingReviewScan = Boolean(
    activeReviewOdontogramPath && resolvedReviewScan.path !== activeReviewOdontogramPath
  );
  const reviewOdontogramSignedUrl =
    activeReviewOdontogramPath && resolvedReviewScan.path === activeReviewOdontogramPath
      ? resolvedReviewScan.url
      : null;

  const refreshFromSupabase = useCallback(
    async (showNotice = true) => {
      setIsSyncing(true);
      try {
        const [patientsRes, pendingRes] = await Promise.all([
          fetchPatientsFromSupabase(),
          fetchPendingFromSupabase(),
        ]);

        let loadedCount = 0;
        if (patientsRes.success) {
          const nextPatients = patientsRes.data || [];
          setPatients(nextPatients);
          loadedCount += nextPatients.length;
        }

        if (pendingRes.success) {
          const nextPending = pendingRes.data || [];
          setPending(nextPending);
          loadedCount += nextPending.length;
        }

        if (showNotice) {
          if (patientsRes.success && loadedCount > 0) {
            showToast(`✓ Synchronized ${loadedCount} patient records with Supabase`);
          } else if (!patientsRes.success) {
            showToast("⚡ Using cached patient records (cloud sync unavailable)");
          } else {
            showToast(`✓ Synced with Supabase (${loadedCount} records)`);
          }
        }
      } catch (err) {
        console.warn("Failed fetching from Supabase:", err);
      } finally {
        setIsSyncing(false);
      }
    },
    [showToast]
  );

  // Load clinical records from Supabase whenever an authenticated user is resolved
  useEffect(() => {
    if (!currentUser?.id) return;
    let active = true;
    (async () => {
      try {
        const [patientsRes, pendingRes] = await Promise.all([
          fetchPatientsFromSupabase(),
          fetchPendingFromSupabase(),
        ]);
        if (!active) return;
        if (patientsRes.success) {
          setPatients(patientsRes.data || []);
        }
        if (pendingRes.success) {
          setPending(pendingRes.data || []);
        }
      } catch (err) {
        console.warn("Initial Supabase load error:", err);
      }
    })();
    return () => {
      active = false;
    };
  }, [currentUser?.id]);

  const handleSignOut = async () => {
    setAuthError("");
    clearSessionPhiState();
    await supabase.auth.signOut();
    setCurrentUser(null);
    navigate("/login", { replace: true });
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
    if (!canDeleteRecords(currentUser)) {
      showToast("❌ Permission Denied: Only Dentistry Department Faculty and System Administrators can delete records.");
      return { success: false };
    }
    if (!patient || !recordsToDelete.length) return { success: false };

    const res = await deleteSelectedPatientRecords(patient, recordsToDelete);
    if (!res?.success) {
      showToast(`❌ ${res?.error || "Operation failed."}`);
      return res || { success: false };
    }

    const deletedSet = new Set(res.deletedIds || []);
    const numericId = to8DigitId(patient.id || patient.eightDigitId);

    setPending((prev) =>
      prev.filter((p) => {
        const subId = p.submissionId || `pending_${to8DigitId(p.eightDigitId || p.id)}_${p.visitDate || ""}`;
        return (
          !deletedSet.has(subId) &&
          !deletedSet.has(p.submissionId) &&
          !(p.dbId != null && deletedSet.has(String(p.dbId)))
        );
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
    if (!canDeleteRecords(currentUser)) {
      showToast("❌ Permission Denied: Only Dentistry Department Faculty and System Administrators can delete patient records.");
      return { success: false };
    }
    if (!patient) return { success: false };
    const numericId = to8DigitId(patient.id || patient.eightDigitId);

    const res = await deleteEntirePatient(patient);
    if (!res?.success) {
      showToast(`❌ ${res?.error || "Operation failed."}`);
      return res || { success: false };
    }

    setPatients((prev) => prev.filter((p) => to8DigitId(p.eightDigitId || p.id) !== numericId));
    setPending((prev) => prev.filter((p) => to8DigitId(p.eightDigitId || p.id) !== numericId));
    if (historyTarget && to8DigitId(historyTarget.patient?.id) === numericId) {
      setHistoryTarget(null);
    }
    if (viewRecordTarget && to8DigitId(viewRecordTarget.patient?.id) === numericId) {
      setViewRecordTarget(null);
    }

    showToast(`✓ Deleted patient record #${numericId} (${patient.name}).`);
    return res;
  };

  // Open the actual submitted digital ODF record (rather than a summary content modal)
  const handleReview = (pendingItem) => {
    if (!pendingItem) return;
    const numericId = to8DigitId(pendingItem.eightDigitId || pendingItem.id);
    const matchedPatient =
      patients.find((p) => to8DigitId(p.id) === numericId) || {
        id: numericId,
        eightDigitId: numericId,
        name: pendingItem.name || "Unnamed Patient",
        lastVisit: pendingItem.visitDate || "",
        clinician: pendingItem.clinician || DEFAULT_CLINICIAN,
        procedure: pendingItem.procedure || "Oral Diagnosis Form (ODF)",
        notes: pendingItem.notes || "",
        odfData: pendingItem.odfDetails || {},
      };

    const pseudoRecord = {
      id: pendingItem.submissionId || `pending_${numericId}_${pendingItem.visitDate || ""}`,
      date: pendingItem.visitDate || new Date().toLocaleDateString("en-US"),
      title: pendingItem.procedure || "Oral Diagnosis Form (ODF) Submission",
      type: "odf",
      clinician: pendingItem.clinician || DEFAULT_CLINICIAN,
      summary: pendingItem.notes || pendingItem.odfDetails?.historyOfPresentIllness || "",
      notes: pendingItem.notes || pendingItem.odfDetails?.historyOfPresentIllness || "",
      rawScanUrl: pendingItem.rawScanUrl || pendingItem.odfDetails?.rawScanUrl || null,
      rawScanPage2Url: pendingItem.rawScanPage2Url || pendingItem.odfDetails?.rawScanPage2Url || null,
      odontogramCropUrl: pendingItem.odontogramCropUrl || pendingItem.odfDetails?.odontogramCropUrl || null,
      consentCropUrl: pendingItem.consentCropUrl || pendingItem.odfDetails?.consentCropUrl || null,
      odfDetails: pendingItem.odfDetails || {},
    };

    setViewRecordTarget({
      patient: matchedPatient,
      record: pseudoRecord,
      source: "submission",
      pendingItem,
    });
  };

  // Submit Oral Diagnosis Form (ODF) to pending approvals only (never alters master patients pre-approval)
  const handleUploadODF = async (odfItem) => {
    const formattedId = to8DigitId(odfItem.id || odfItem.eightDigitId);
    const formattedPending = {
      ...odfItem,
      id: formattedId,
      eightDigitId: formattedId,
      clinician: odfItem.clinician || DEFAULT_CLINICIAN,
    };

    showToast(`Submitting ODF for Patient #${formattedId}...`);

    const res = await savePendingToSupabase(formattedPending);
    if (!res?.success) {
      showToast(`❌ ${res?.error || "Operation failed."}`);
      return res || { success: false };
    }

    const savedSubmission = res.data || formattedPending;
    setPending((prev) => [
      savedSubmission,
      ...prev.filter(
        (p) =>
          String(p.submissionId || p.dbId || "") !==
          String(savedSubmission.submissionId || savedSubmission.dbId || "")
      ),
    ]);

    showToast(`✓ ODF #${formattedId} submitted for faculty approval!`);
    return res;
  };

  // Approve a pending request via server-side RPC
  const handleApprove = async (item) => {
    if (!canApproveODF(currentUser)) {
      showToast("❌ Permission Denied: Student Clinicians cannot approve ODF submissions. Only Faculty and System Administrators can approve.");
      return { success: false };
    }
    const formattedId = to8DigitId(item.id || item.eightDigitId);
    const targetDbId = item.dbId ? String(item.dbId) : null;
    const targetSubId = item.submissionId ? String(item.submissionId) : null;

    showToast(`Approving #${formattedId} (${item.name})...`);

    const res = await approvePendingInSupabase(item);
    if (!res?.success) {
      showToast(`❌ ${res?.error || "Operation failed."}`);
      return res || { success: false };
    }

    setPending((prev) =>
      prev.filter((p) => {
        if (targetDbId && p.dbId != null) return String(p.dbId) !== targetDbId;
        if (targetSubId && p.submissionId) return String(p.submissionId) !== targetSubId;
        return to8DigitId(p.id) !== formattedId;
      })
    );

    if (res.data) {
      setPatients((prev) => [
        res.data,
        ...prev.filter(
          (p) =>
            to8DigitId(p.eightDigitId || p.id) !== res.data.eightDigitId &&
            p.id !== res.data.id
        ),
      ]);
    }

    setActiveReviewModal(null);
    showToast(`✓ Successfully approved & added to #${formattedId} record history!`);
    return res;
  };

  // Decline a pending request
  const handleDecline = async (item) => {
    if (!canApproveODF(currentUser)) {
      showToast("❌ Permission Denied: Student Clinicians cannot decline ODF submissions.");
      return { success: false };
    }
    const formattedId = to8DigitId(item.id || item.eightDigitId);
    const targetDbId = item.dbId ? String(item.dbId) : null;
    const targetSubId = item.submissionId ? String(item.submissionId) : null;

    showToast(`Declining #${formattedId} (${item.name})...`);

    const res = await declinePendingInSupabase(item);
    if (!res?.success) {
      showToast(`❌ ${res?.error || "Operation failed."}`);
      return res || { success: false };
    }

    setPending((prev) =>
      prev.filter((p) => {
        if (targetDbId && p.dbId != null) return String(p.dbId) !== targetDbId;
        if (targetSubId && p.submissionId) return String(p.submissionId) !== targetSubId;
        return to8DigitId(p.id) !== formattedId;
      })
    );
    setActiveReviewModal(null);
    showToast(`✓ Declined request for #${formattedId} in Supabase.`);
    return res;
  };

  // Seed sample records into Supabase (restricted strictly to System Admins in development mode)
  const handleSeedSupabase = async () => {
    if (!import.meta.env.DEV || currentUser?.role !== "System Admin") {
      return;
    }
    showToast("Seeding 8-digit sample data to Supabase...");
    let savedPatients = 0;
    let savedPending = 0;
    const seedPatients = patients.length > 0 ? patients : DEFAULT_PATIENTS;
    const seedPending = pending.length > 0 ? pending : DEFAULT_PENDING;

    for (const p of seedPatients) {
      const res = await savePatientToSupabase(p);
      if (res.success) savedPatients++;
    }

    for (const pend of seedPending) {
      const res = await savePendingToSupabase(pend);
      if (res.success) savedPending++;
    }

    if (savedPatients > 0 || savedPending > 0) {
      await refreshFromSupabase(false);
      showToast(`✓ Seeded ${savedPatients} patients and ${savedPending} pending requests!`);
    } else {
      showToast("Unable to seed sample data to Supabase right now.");
    }
  };

  // Wait for initial session + profile resolution before rendering protected views or redirecting to /login
  if (authLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffbfd7",
          fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif',
          padding: "20px",
        }}
      >
        <div
          style={{
            background: "#ffffff",
            borderRadius: "20px",
            padding: "26px 32px",
            boxShadow: "0 20px 45px -10px rgba(0, 0, 0, 0.12)",
            textAlign: "center",
            color: "#0f172a",
            fontWeight: "700",
            fontSize: "14px",
          }}
        >
          Verifying session...
        </div>
      </div>
    );
  }

  // Unauthenticated routes
  if (!currentUser) {
    return (
      <Routes>
        <Route
          path="/login"
          element={<Login authError={authError} onClearError={() => setAuthError("")} />}
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
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
        <Route path="/login" element={<Navigate to="/patients" replace />} />
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

      {/* Full 2-Page Digital ODF Viewer when clicking "View Record", "View Submission", or "Review Submission" */}
      {viewRecordTarget && (
        <OralDiagnosisForm
          key={`view-${to8DigitId(viewRecordTarget.patient?.id)}-${viewRecordTarget.record?.id || "rec"}`}
          patientId={to8DigitId(viewRecordTarget.patient?.id || viewRecordTarget.patient?.eightDigitId)}
          patients={patients}
          pending={pending}
          readOnly={true}
          isSubmissionView={viewRecordTarget.source === "submission"}
          onViewUploadedScans={
            viewRecordTarget.pendingItem && canApproveODF(currentUser)
              ? () => setReviewDocModalTarget(viewRecordTarget.pendingItem)
              : null
          }
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
        const allowApprove = canApproveODF(currentUser);
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
                      {isResolvingReviewScan ? (
                        <div style={{ fontSize: "12px", color: "#64748b", padding: "12px" }}>
                          Loading secure odontogram preview...
                        </div>
                      ) : reviewOdontogramSignedUrl ? (
                        <img
                          src={reviewOdontogramSignedUrl}
                          alt="Odontogram preview"
                          style={{ maxHeight: "140px", maxWidth: "100%", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                        />
                      ) : (
                        <div style={{ fontSize: "12px", color: "#94a3b8", padding: "12px" }}>
                          Unable to load odontogram preview.
                        </div>
                      )}
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
