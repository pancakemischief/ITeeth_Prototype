import PatientRecord from "./PatientRecord";

/**
 * Dashboard wrapper component managing role-aware clinical views
 */
export default function Dashboard(props) {
  return <PatientRecord {...props} />;
}
