/**
 * Role helper utilities for I-Teeth
 */

function extractRoleValue(userOrRole) {
  if (userOrRole && typeof userOrRole === "object") {
    return userOrRole.role;
  }
  return userOrRole;
}

export function normalizeRole(userOrRole) {
  const role = extractRoleValue(userOrRole);
  if (!role) return "";
  const r = String(role).toLowerCase().trim();
  if (r === "system_admin" || r === "admin" || r.includes("admin")) return "admin";
  if (r === "faculty" || r.includes("faculty")) return "faculty";
  if (r === "patient" || r.includes("patient")) return "patient";
  if (r === "student_clinician" || r.includes("student") || r.includes("clinician")) {
    return "student_clinician";
  }
  return "";
}

export function getRoleTitle(userOrRole) {
  const norm = normalizeRole(userOrRole);
  switch (norm) {
    case "admin":
      return "System Admin";
    case "faculty":
      return "Faculty";
    case "patient":
      return "Patient";
    case "student_clinician":
      return "Student Clinician";
    default:
      return "";
  }
}

export function canUploadODF(userOrRole) {
  const norm = normalizeRole(userOrRole);
  return norm === "student_clinician" || norm === "faculty" || norm === "admin";
}

export function canApproveODF(userOrRole) {
  const norm = normalizeRole(userOrRole);
  return norm === "faculty" || norm === "admin";
}

export function isStudentClinician(userOrRole) {
  const norm = normalizeRole(userOrRole);
  return norm === "student_clinician";
}

export function canAccessDeveloperOptions(userOrRole) {
  const norm = normalizeRole(userOrRole);
  return norm === "admin";
}

export function canViewPendingApprovals(userOrRole) {
  const norm = normalizeRole(userOrRole);
  return Boolean(norm) && norm !== "patient";
}

export function canDeleteRecords(userOrRole) {
  const norm = normalizeRole(userOrRole);
  return norm === "faculty" || norm === "admin";
}
