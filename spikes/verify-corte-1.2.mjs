#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
export const requiredSpikes = [
  "host-integration",
  "runtime-node20",
  "canonical-core",
  "worktree-merge",
  "transaction-recovery",
  "integrated-prototype"
];
const allowedStates = new Set(["PLANNED", "IN_PROGRESS", "PASSED", "FAILED", "INCONCLUSIVE", "DECISION_ACCEPTED_WITH_LIMITATIONS"]);
const allowedCriterionStates = new Set(["PENDING", "PASSED", "FAILED", "NOT_APPLICABLE"]);

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function requireNonEmpty(errors, spikeId, field, value) {
  if (!Array.isArray(value) || value.length === 0) errors.push(`${spikeId}: ${field} must be non-empty`);
}

function requireValue(errors, spikeId, field, value) {
  if (!hasValue(value)) errors.push(`${spikeId}: ${field} is required for a completed spike`);
}

function validateCriteria(errors, spikeId, criteria, category) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    errors.push(`${spikeId}: ${category} required`);
    return;
  }
  for (const criterion of criteria) {
    if (!hasValue(criterion.id) || !hasValue(criterion.severity) || typeof criterion.waivable !== "boolean") {
      errors.push(`${spikeId}: every ${category} criterion requires id, severity and waivable`);
    }
    if (!allowedCriterionStates.has(criterion.status)) errors.push(`${spikeId}: ${criterion.id || category} has invalid status`);
    if (criterion.status === "NOT_APPLICABLE" && criterion.waivable !== true) {
      errors.push(`${spikeId}: ${criterion.id || category} cannot be NOT_APPLICABLE when waivable is false`);
    }
  }
}

export function validateManifest(manifest, spikeId, { structureOnly = false } = {}) {
  const errors = [];
  if (manifest.id !== spikeId) errors.push(`${spikeId}: id must match directory`);
  if (!allowedStates.has(manifest.status)) errors.push(`${spikeId}: invalid status`);
  if (typeof manifest.critical !== "boolean") errors.push(`${spikeId}: critical is required`);
  if (typeof manifest.waivable !== "boolean") errors.push(`${spikeId}: waivable is required`);
  for (const field of ["hypothesis", "scope", "non_goals", "timebox", "prototype_location", "reusable_or_disposable", "inputs", "fault_model", "adr", "decision", "result"]) {
    if (!(field in manifest)) errors.push(`${spikeId}: ${field} is required`);
  }
  validateCriteria(errors, spikeId, manifest.pass_criteria, "pass_criteria");
  validateCriteria(errors, spikeId, manifest.fail_criteria, "fail_criteria");
  for (const field of ["evidence", "fixtures", "tests"]) {
    if (!Array.isArray(manifest[field])) errors.push(`${spikeId}: ${field} must be an array`);
  }

  if (manifest.status === "PASSED") {
    requireNonEmpty(errors, spikeId, "evidence", manifest.evidence);
    requireNonEmpty(errors, spikeId, "fixtures", manifest.fixtures);
    requireNonEmpty(errors, spikeId, "tests", manifest.tests);
    requireValue(errors, spikeId, "adr", manifest.adr);
    requireValue(errors, spikeId, "decision", manifest.decision);
    requireValue(errors, spikeId, "result", manifest.result);
    if ((manifest.pass_criteria || []).some((criterion) => criterion.status !== "PASSED")) errors.push(`${spikeId}: every pass criterion must be PASSED`);
    if ((manifest.fail_criteria || []).some((criterion) => criterion.status === "FAILED")) errors.push(`${spikeId}: no fail criterion may be FAILED`);
  }

  if (manifest.status === "DECISION_ACCEPTED_WITH_LIMITATIONS") {
    requireNonEmpty(errors, spikeId, "evidence", manifest.evidence);
    requireValue(errors, spikeId, "adr", manifest.adr);
    requireValue(errors, spikeId, "decision", manifest.decision);
    requireValue(errors, spikeId, "result", manifest.result);
    for (const field of ["affected_criteria", "accepted_risk", "owner", "mitigation", "reopen_condition"]) requireValue(errors, spikeId, field, manifest[field]);
    const criticalFailure = [...(manifest.pass_criteria || []), ...(manifest.fail_criteria || [])]
      .some((criterion) => criterion.status === "FAILED" && criterion.severity === "critical" && criterion.waivable === false);
    if (criticalFailure) errors.push(`${spikeId}: critical non-waivable failure cannot be accepted with limitations`);
  }

  if (!structureOnly && !["PASSED", "DECISION_ACCEPTED_WITH_LIMITATIONS"].includes(manifest.status)) errors.push(`${spikeId}: status ${manifest.status} does not close the spike`);
  return errors;
}

export async function verify({ structureOnly = false } = {}) {
  const errors = [];
  for (const spikeId of requiredSpikes) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(root, spikeId, "spike.json"), "utf8"));
      errors.push(...validateManifest(manifest, spikeId, { structureOnly }));
    } catch (error) {
      errors.push(`${spikeId}: ${error.code === "ENOENT" ? "spike.json is missing" : error.message}`);
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const structureOnly = process.argv.includes("--structure-only");
  const errors = await verify({ structureOnly });
  if (errors.length > 0) {
    console.error(`Corte -1.2 verification failed (${errors.length} issue(s))`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
  } else {
    console.log(structureOnly ? "Corte -1.2 structure verification passed" : "Corte -1.2 verification passed");
  }
}
