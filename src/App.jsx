import { useState, useEffect, useCallback } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Login from "./components/Login";
import PatientRecord from "./components/PatientRecord";
import PendingApproval from "./components/PendingApproval";
import Settings from "./components/Settings";
import {
  fetchPatientsFromSupabase,
  fetchPendingFromSupabase,
  savePatientToSupabase,
  savePendingToSupabase,
  approvePendingInSupabase,
  declinePendingInSupabase,
  to8DigitId,
  DEFAULT_CLINICIAN,
} from "./lib/dentalService";

// Strictly 8-Digit Patient IDs and Dr. Jane Doe, MD as Attending Clinician
const DEFAULT_PATIENTS = [
  { id: "10000001", eightDigitId: "10000001", name: "John Doe", lastVisit: "01/01/2026", clinician: DEFAULT_CLINICIAN, procedure: "Biannual Prophylaxis & Bitewing X-Rays" },
  { id: "10000002", eightDigitId: "10000002", name: "Sarah Connor", lastVisit: "02/14/2026", clinician: DEFAULT_CLINICIAN, procedure: "Endodontic Therapy #14" },
  { id: "10000003", eightDigitId: "10000003", name: "Marcus Wright", lastVisit: "03/10/2026", clinician: DEFAULT_CLINICIAN, procedure: "Composite Restoration #30 MOD" },
  { id: "10000004", eightDigitId: "10000004", name: "Kyle Reese", lastVisit: "03/18/2026", clinician: DEFAULT_CLINICIAN, procedure: "Gingival Scaling & Root Planing" },
];

const DEFAULT_PENDING = [
  { id: "10000005", name: "Grace Brewster", visitDate: "03/22/2026", clinician: DEFAULT_CLINICIAN, procedure: "Composite Restoration Tooth #19", notes: "Class II resin restoration required. Supervising faculty sign-off requested." },
  { id: "10000006", name: "Arthur Dent", visitDate: "03/24/2026", clinician: DEFAULT_CLINICIAN, procedure: "Panoramic Radiograph Evaluation", notes: "Full mouth series review for third molar impaction." },
];

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

  const [patients, setPatients] = useState(DEFAULT_PATIENTS);
  const [pending, setPending] = useState(DEFAULT_PENDING);
  const [activeModal, setActiveModal] = useState(null); // { type: 'view' | 'review', item: ... }
  const [notification, setNotification] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const showToast = (message) => {
    setNotification(message);
    setTimeout(() => {
      setNotification((current) => (current === message ? null : current));
    }, 4000);
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
        if (patientsRes.success && patientsRes.data && patientsRes.data.length > 0) {
          setPatients(patientsRes.data);
        }
        if (pendingRes.success && pendingRes.data && pendingRes.data.length > 0) {
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
      if (patientsRes.success && patientsRes.data && patientsRes.data.length > 0) {
        setPatients(patientsRes.data);
        loadedCount += patientsRes.data.length;
      }

      if (pendingRes.success && pendingRes.data && pendingRes.data.length > 0) {
        setPending(pendingRes.data);
        loadedCount += pendingRes.data.length;
      }

      if (showNotice) {
        if (loadedCount > 0) {
          showToast(`✓ Loaded ${loadedCount} records from Supabase`);
        } else if (!patientsRes.success) {
          showToast("⚡ Supabase ready. Create tables in Supabase SQL editor to persist records.");
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

  const handleViewRecords = (patient) => {
    setActiveModal({ type: "view", item: patient });
  };

  const handleReview = (pendingItem) => {
    setActiveModal({ type: "review", item: pendingItem });
  };

  // Write new patient to Supabase
  const handleAddPatient = async (newPatient) => {
    const formatted = {
      ...newPatient,
      id: to8DigitId(newPatient.id),
      clinician: newPatient.clinician || DEFAULT_CLINICIAN,
    };
    setPatients((prev) => [formatted, ...prev.filter((p) => p.id !== formatted.id)]);
    showToast(`Saving patient #${formatted.id} (${formatted.name}) to Supabase...`);

    const res = await savePatientToSupabase(formatted);
    if (res.success && res.data) {
      setPatients((prev) => [
        res.data,
        ...prev.filter((p) => p.id !== formatted.id && p.id !== res.data.id),
      ]);
      showToast(`✓ Patient #${formatted.id} saved to Supabase!`);
    } else if (res.success) {
      showToast(`✓ Patient #${formatted.id} saved to Supabase!`);
    } else {
      showToast(`Saved locally (${res.error || "Supabase offline"})`);
    }
  };

  // Submit Oral Diagnosis Form (ODF) or pending approval
  const handleUploadODF = async (odfItem) => {
    const formatted = {
      ...odfItem,
      id: to8DigitId(odfItem.id),
      clinician: odfItem.clinician || DEFAULT_CLINICIAN,
    };
    setPending((prev) => [formatted, ...prev.filter((p) => p.id !== formatted.id)]);
    showToast(`Submitting ODF for Patient #${formatted.id} to Supabase...`);

    const res = await savePendingToSupabase(formatted);
    if (res.success) {
      showToast(`✓ ODF for Patient #${formatted.id} submitted for faculty review!`);
    } else {
      showToast(`Saved locally (${res.error || "Supabase offline"})`);
    }
  };

  // Approve a pending request
  const handleApprove = async (item) => {
    const formattedId = to8DigitId(item.id);
    setPending((prev) => prev.filter((p) => to8DigitId(p.id) !== formattedId));
    const approvedPatient = {
      id: formattedId,
      eightDigitId: formattedId,
      name: item.name,
      lastVisit: item.visitDate || new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
      clinician: item.clinician || DEFAULT_CLINICIAN,
      procedure: item.procedure,
      notes: item.notes,
    };
    setPatients((prev) => [
      approvedPatient,
      ...prev.filter((p) => to8DigitId(p.id) !== formattedId),
    ]);
    setActiveModal(null);
    showToast(`✓ Approved #${formattedId} (${item.name}). Syncing with Supabase...`);

    const res = await approvePendingInSupabase(item);
    if (res.success) {
      if (res.data) {
        setPatients((prev) => [
          res.data,
          ...prev.filter((p) => to8DigitId(p.id) !== formattedId && p.id !== res.data.id),
        ]);
      }
      showToast(`✓ Successfully approved & synced #${formattedId} in Supabase!`);
    } else {
      showToast(`✓ Approved locally (Supabase: ${res.error || "offline"})`);
    }
  };

  // Decline a pending request
  const handleDecline = async (item) => {
    const formattedId = to8DigitId(item.id);
    setPending((prev) => prev.filter((p) => to8DigitId(p.id) !== formattedId));
    setActiveModal(null);
    showToast(`Declining #${formattedId} (${item.name})...`);

    const res = await declinePendingInSupabase(item);
    if (res.success) {
      showToast(`✕ Declined request for #${formattedId} in Supabase.`);
    } else {
      showToast(`✕ Declined request locally.`);
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
      showToast(`✓ Seeded ${savedPatients} patients and ${savedPending} pending requests to Supabase!`);
    } else {
      showToast("⚡ Tables not found in Supabase. Copy SQL schema in Settings and run in Supabase SQL editor!");
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
            padding: "10px 18px",
            borderRadius: "12px",
            fontSize: "12.5px",
            fontWeight: 600,
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            border: "1px solid rgba(255,255,255,0.1)",
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
              onNavigate={handleNavigate}
              onViewRecords={handleViewRecords}
              onAddPatient={handleAddPatient}
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

      {/* Detail / Review Modal with 8-Digit ID and Dr. Jane Doe, MD */}
      {activeModal && (
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
          onClick={() => setActiveModal(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "480px",
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
                padding: "24px",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "10px",
                    background: "rgba(255, 255, 255, 0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                    <rect x="3" y="7" width="18" height="13" rx="2" />
                    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="12" y1="11" x2="12" y2="15" />
                    <line x1="10" y1="13" x2="14" y2="13" />
                  </svg>
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: "17px", fontWeight: "800" }}>
                    {activeModal.type === "view" ? "Clinical Patient Record" : "Review Oral Diagnosis Form (ODF)"}
                  </h3>
                  <p style={{ margin: 0, fontSize: "11px", opacity: 0.9 }}>
                    Escolar Dental Records System
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveModal(null)}
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
                  display: "grid",
                  placeItems: "center",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "22px 24px" }}>
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
                  <strong style={{ color: "#475569" }}>Patient ID (8 Digits):</strong>{" "}
                  <code style={{ background: "#fff", padding: "2px 8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontWeight: "700", color: "#0f172a" }}>
                    {to8DigitId(activeModal.item.id)}
                  </code>
                </p>
                <p style={{ margin: "3px 0" }}>
                  <strong style={{ color: "#475569" }}>Patient Name:</strong> {activeModal.item.name}
                </p>
                {activeModal.item.email && (
                  <p style={{ margin: "3px 0" }}>
                    <strong style={{ color: "#475569" }}>Email:</strong> {activeModal.item.email}
                  </p>
                )}
                {activeModal.item.phone && (
                  <p style={{ margin: "3px 0" }}>
                    <strong style={{ color: "#475569" }}>Phone:</strong> {activeModal.item.phone}
                  </p>
                )}
                <p style={{ margin: "3px 0" }}>
                  <strong style={{ color: "#475569" }}>
                    {activeModal.type === "view" ? "Last Visit:" : "Visit Date:"}
                  </strong>{" "}
                  {activeModal.item.lastVisit || activeModal.item.visitDate}
                </p>
                <p style={{ margin: "3px 0" }}>
                  <strong style={{ color: "#475569" }}>Attending Clinician:</strong> {activeModal.item.clinician || DEFAULT_CLINICIAN}
                </p>
                {activeModal.item.procedure && (
                  <p style={{ margin: "3px 0" }}>
                    <strong style={{ color: "#475569" }}>Procedure / Diagnosis:</strong> {activeModal.item.procedure}
                  </p>
                )}
                {activeModal.item.notes && (
                  <p style={{ margin: "3px 0" }}>
                    <strong style={{ color: "#475569" }}>Clinical Findings:</strong> {activeModal.item.notes}
                  </p>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                {activeModal.type === "review" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDecline(activeModal.item)}
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
                      onClick={() => handleApprove(activeModal.item)}
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
                    onClick={() => setActiveModal(null)}
                    style={{
                      background: "linear-gradient(135deg, #e91e77 0%, #ec206f 100%)",
                      color: "#ffffff",
                      border: "none",
                      padding: "9px 22px",
                      borderRadius: "12px",
                      fontWeight: "700",
                      cursor: "pointer",
                      fontSize: "13px",
                      boxShadow: "0 4px 12px rgba(233, 30, 119, 0.3)",
                    }}
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
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
