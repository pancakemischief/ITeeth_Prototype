/**
 * Role helper utilities for I-Teeth
 */

export function normalizeRole(role) {
  if (!role) return "student_clinician";
  const r = String(role).toLowerCase();
  if (r.includes("admin")) return "admin";
  if (r.includes("faculty")) return "faculty";
  if (r.includes("patient")) return "patient";
  if (r.includes("student") || r.includes("clinician")) return "student_clinician";
  return "student_clinician";
}

export function getRoleTitle(role) {
  const norm = normalizeRole(role);
  switch (norm) {
    case "admin":
      return "System Administrator";
    case "faculty":
      return "Dentistry Department Faculty";
    case "patient":
      return "Patient";
    case "student_clinician":
    default:
      return "Student Clinician";
  }
}

export function canUploadODF(role) {
  const norm = normalizeRole(role);
  return norm === "student_clinician" || norm === "faculty" || norm === "admin";
}

export function canApproveODF(role) {
  const norm = normalizeRole(role);
  return norm === "faculty" || norm === "admin";
}

export function canAccessDeveloperOptions(role) {
  const norm = normalizeRole(role);
  return norm === "admin";
}

export function canViewPendingApprovals(role) {
  const norm = normalizeRole(role);
  return norm !== "patient";
}
