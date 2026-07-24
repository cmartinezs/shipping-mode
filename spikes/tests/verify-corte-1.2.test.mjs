import assert from "node:assert/strict";
import { validateManifest } from "../verify-corte-1.2.mjs";

const base = () => ({
  id: "test",
  status: "PLANNED",
  hypothesis: "h",
  scope: "s",
  non_goals: [],
  timebox: "1 day",
  prototype_location: "spikes/test",
  reusable_or_disposable: "reusable",
  inputs: [],
  fault_model: [],
  critical: true,
  waivable: false,
  pass_criteria: [{ id: "pass", severity: "critical", waivable: false, status: "PENDING", evidence_refs: [] }],
  fail_criteria: [{ id: "fail", severity: "critical", waivable: false, status: "PENDING", evidence_refs: [] }],
  evidence: [], fixtures: [], tests: [], adr: null, decision: null, result: null
});
const errors = (manifest) => validateManifest(manifest, "test");
const has = (manifest, text) => errors(manifest).some((error) => error.includes(text));

assert.equal(validateManifest(base(), "test", { structureOnly: true }).length, 0, "structure-planned-valid");
for (const [field, label] of [["evidence", "passed-with-empty-evidence-invalid"], ["fixtures", "passed-with-empty-fixtures-invalid"], ["tests", "passed-with-empty-tests-invalid"]]) {
  const manifest = base(); manifest.status = "PASSED"; manifest.pass_criteria[0].status = "PASSED";
  manifest[field] = ["ok"];
  if (field !== "evidence") manifest.evidence = ["evidence"];
  if (field !== "fixtures") manifest.fixtures = ["fixture"];
  if (field !== "tests") manifest.tests = ["test"];
  if (field === "evidence") manifest.evidence = [];
  if (field === "fixtures") manifest.fixtures = [];
  if (field === "tests") manifest.tests = [];
  assert.equal(errors(manifest).length > 0, true, label);
}
for (const [field, label] of [["adr", "passed-with-null-adr-invalid"], ["decision", "passed-with-null-decision-invalid"], ["result", "passed-with-null-result-invalid"]]) {
  const manifest = base(); manifest.status = "PASSED"; manifest.pass_criteria[0].status = "PASSED";
  manifest.evidence = ["evidence"]; manifest.fixtures = ["fixture"]; manifest.tests = ["test"];
  manifest[field] = null;
  assert.equal(errors(manifest).length > 0, true, label);
}
for (const [status, label] of [["PENDING", "passed-with-pending-criterion-invalid"], ["FAILED", "passed-with-failed-pass-criterion-invalid"]]) {
  const manifest = base(); manifest.status = "PASSED"; manifest.pass_criteria[0].status = status;
  manifest.evidence = ["evidence"]; manifest.fixtures = ["fixture"]; manifest.tests = ["test"];
  manifest.adr = "docs/adr/ADR-0001.md"; manifest.decision = "accepted"; manifest.result = "pass";
  assert.equal(errors(manifest).length > 0, true, label);
}
const limited = base();
limited.status = "DECISION_ACCEPTED_WITH_LIMITATIONS";
limited.affected_criteria = ["fail"]; limited.accepted_risk = "risk"; limited.owner = "owner"; limited.mitigation = "mitigation"; limited.reopen_condition = "condition";
limited.evidence = ["evidence"]; limited.adr = "docs/adr/ADR-0001.md"; limited.decision = "accepted"; limited.result = "limited";
limited.fail_criteria[0].status = "FAILED";
assert.equal(errors(limited).length > 0, true, "limited-with-critical-failure-invalid");
const withoutReopen = { ...limited, affected_criteria: ["fail"] };
delete withoutReopen.reopen_condition;
assert.equal(errors(withoutReopen).length > 0, true, "limited-without-reopen-condition-invalid");

const complete = base();
complete.status = "PASSED"; complete.pass_criteria[0].status = "PASSED";
complete.evidence = ["evidence"]; complete.fixtures = ["fixture"]; complete.tests = ["test"];
complete.adr = "docs/adr/ADR-0001.md"; complete.decision = "passed"; complete.result = "verified";
assert.deepEqual(errors(complete), [], "complete-passed-valid");
console.log("Corte -1.2 verifier tests: 12 passed");
