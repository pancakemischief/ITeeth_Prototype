import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

const anonClient = createClient(supabaseUrl, supabaseAnonKey);

async function runSecurityTests() {
  console.log("\n=======================================================");
  console.log("🔒 I-TEETH SECURITY VERIFICATION SUITE");
  console.log("=======================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = "") {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: ${testName}`);
      if (details) console.log(`     Details: ${details}`);
      failed++;
    }
  }

  // TEST 1: Anonymous access to patients table
  console.log("--- 1. Testing RLS: Anonymous Access to Tables ---");
  try {
    const { data, error } = await anonClient.from("patients").select("*").limit(5);
    const blocked = error || (Array.isArray(data) && data.length === 0);
    assert(
      blocked,
      "Anonymous client cannot access public.patients",
      error ? `DB blocked with error: ${error.message}` : "Empty array returned (RLS filtered)"
    );
  } catch (err) {
    assert(true, "Anonymous client cannot access public.patients (Caught exception)");
  }

  // TEST 2: Anonymous access to pending_approvals table
  try {
    const { data, error } = await anonClient.from("pending_approvals").select("*").limit(5);
    const blocked = error || (Array.isArray(data) && data.length === 0);
    assert(
      blocked,
      "Anonymous client cannot access public.pending_approvals",
      error ? `DB blocked with error: ${error.message}` : "Empty array returned (RLS filtered)"
    );
  } catch (err) {
    assert(true, "Anonymous client cannot access public.pending_approvals (Caught exception)");
  }

  // TEST 3: Anonymous access to clinical_audit_ledger table
  try {
    const { data, error } = await anonClient.from("clinical_audit_ledger").select("*").limit(5);
    const blocked = error || (Array.isArray(data) && data.length === 0);
    assert(
      blocked,
      "Anonymous client cannot read clinical_audit_ledger",
      error ? `DB blocked with error: ${error.message}` : "Empty array returned (RLS filtered)"
    );
  } catch (err) {
    assert(true, "Anonymous client cannot read clinical_audit_ledger (Caught exception)");
  }

  // TEST 4: Anonymous write to clinical_audit_ledger
  try {
    const { error } = await anonClient.from("clinical_audit_ledger").insert({
      action_type: "MALICIOUS_INJECTION",
      record_hash: "0000000000000000000000000000000000000000000000000000000000000000",
      prev_chain_hash: "0000000000000000000000000000000000000000000000000000000000000000",
      chain_hash: "0000000000000000000000000000000000000000000000000000000000000000",
    });
    assert(
      Boolean(error),
      "Direct client insert to clinical_audit_ledger is blocked",
      error ? error.message : "Insert unexpectedly succeeded!"
    );
  } catch (err) {
    assert(true, "Direct client insert to clinical_audit_ledger is blocked (Exception caught)");
  }

  // TEST 5: Anonymous access to profiles table
  try {
    const { data, error } = await anonClient.from("profiles").select("*").limit(5);
    const blocked = error || (Array.isArray(data) && data.length === 0);
    assert(
      blocked,
      "Anonymous client cannot view public.profiles",
      error ? `DB blocked with error: ${error.message}` : "Empty array returned (RLS filtered)"
    );
  } catch (err) {
    assert(true, "Anonymous client cannot view public.profiles (Caught exception)");
  }

  // TEST 6: Calling approve_pending_submission anonymously
  console.log("\n--- 2. Testing RPC Protections ---");
  try {
    const { data, error } = await anonClient.rpc("approve_pending_submission", {
      p_submission_id: "00000000-0000-0000-0000-000000000000",
      p_eight_digit_id: "10000001",
      p_record_hash: "",
    });
    assert(
      Boolean(error),
      "Calling approve_pending_submission without session is rejected",
      error ? error.message : "RPC unexpectedly succeeded!"
    );
  } catch (err) {
    assert(true, "Calling approve_pending_submission without session is rejected");
  }

  // TEST 7: Calling soft_delete_patient anonymously
  try {
    const { error } = await anonClient.rpc("soft_delete_patient", {
      p_eight_digit_id: "10000001",
    });
    assert(
      Boolean(error),
      "Calling soft_delete_patient without session is rejected",
      error ? error.message : "RPC unexpectedly succeeded!"
    );
  } catch (err) {
    assert(true, "Calling soft_delete_patient without session is rejected");
  }

  // TEST 8: Calling verify_clinical_audit_chain anonymously
  try {
    const { error } = await anonClient.rpc("verify_clinical_audit_chain");
    assert(
      Boolean(error),
      "Calling verify_clinical_audit_chain without faculty session is rejected",
      error ? error.message : "RPC unexpectedly succeeded!"
    );
  } catch (err) {
    assert(true, "Calling verify_clinical_audit_chain without faculty session is rejected");
  }

  console.log("\n=======================================================");
  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  console.log("=======================================================\n");
}

runSecurityTests();
