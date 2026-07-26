import fs from "node:fs";
import path from "node:path";
import { validate } from "./schema.mjs";
import { findCommandFingerprintKeyMismatches, MIN_MAX_SOURCE_BYTES, MAX_MAX_SOURCE_BYTES, runDiscoverScan, readConfirmedSources, readConfirmedScopes, allCommandEntries } from "./discoverScan.mjs";
import { computeSourceFingerprint, FingerprintError } from "./fingerprint.mjs";
import { confineScopePath, PathConfinementError } from "./paths.mjs";

function checkScanParametersRange(proposal) {
  const bytes = proposal.scanParameters?.maxSourceBytes;
  if (typeof bytes !== "number" || bytes < MIN_MAX_SOURCE_BYTES || bytes > MAX_MAX_SOURCE_BYTES) {
    return [{ code: "scan_parameters_out_of_range", message: `scanParameters.maxSourceBytes must be between ${MIN_MAX_SOURCE_BYTES} and ${MAX_MAX_SOURCE_BYTES}, got ${bytes}` }];
  }
  return [];
}

function checkDuplicateSourceActions(proposal) {
  const errors = [];
  const seen = new Set();
  for (const entry of proposal.sources || []) {
    const key = entry.action === "add" ? `add:${entry.path}` : `id:${entry.sourceId}`;
    if (seen.has(key)) {
      errors.push({ code: "duplicate_source_action", sourceId: entry.sourceId ?? null, path: entry.action === "add" ? entry.path : null, message: `more than one sources[] entry targets the same ${entry.action === "add" ? "path" : "sourceId"}: ${entry.action === "add" ? entry.path : entry.sourceId}` });
    }
    seen.add(key);
  }
  return errors;
}

function checkDuplicateScopeCommands(proposal) {
  const errors = [];
  const seen = new Set();
  for (const entry of proposal.scopeCommands || []) {
    const key = `${entry.scopeId}:${entry.role}`;
    if (seen.has(key)) {
      errors.push({ code: "duplicate_scope_command", scopeId: entry.scopeId, role: entry.role, message: `more than one scopeCommands[] entry targets scope ${entry.scopeId} role ${entry.role}` });
    }
    seen.add(key);
  }
  return errors;
}

function checkDuplicateScopeKeys(proposal) {
  const errors = [];
  const seen = new Set();
  for (const entry of proposal.scopes || []) {
    if (seen.has(entry.key)) {
      errors.push({ code: "duplicate_scope_key", key: entry.key, message: `more than one scopes[] entry uses the key ${entry.key}` });
    }
    seen.add(entry.key);
  }
  return errors;
}

// A command's identity for the "alternatives must be genuinely distinct" invariant: the exact
// command string plus its sourceRefs AS A SET (order must not matter -- two refs listed in a
// different order are still the same selection). Selected command and every alternative must
// have pairwise-distinct identities; this must fail closed, never silently dedupe.
function commandKey(entry) {
  return `${entry.command}::${[...new Set(entry.sourceRefs || [])].sort().join(",")}`;
}

function checkAlternativeKeyCollisions(proposal) {
  const errors = [];
  for (const command of proposal.scopeCommands || []) {
    const seen = new Set([commandKey(command)]);
    for (const alternative of command.alternatives || []) {
      const key = commandKey(alternative);
      if (seen.has(key)) {
        errors.push({ code: "duplicate_alternative_key", scopeId: command.scopeId, role: command.role, message: `scopeCommands entry for scope ${command.scopeId} role ${command.role} has an alternative whose (command, sourceRefs) matches the selected command or another alternative` });
      }
      seen.add(key);
    }
  }
  return errors;
}

// Builds a throwaway { commands: { <role>: entry, custom: { <name>: entry } } } object shaped
// like a scope.yml document, specifically so this can reuse findCommandFingerprintKeyMismatches
// (which expects that shape, via allCommandEntries) without duplicating its traversal logic.
// A role like "custom.e2e" must land at fakeScope.commands.custom.e2e, not the literal key
// "custom.e2e" -- allCommandEntries only looks inside commands.custom for anything beyond the
// five well-known roles.
//
// One fake scope is built PER ENTRY, not grouped by scopeId: if two scopeCommands[] entries
// share the same (scopeId, role) -- already flagged separately by checkDuplicateScopeCommands --
// grouping by scopeId would let the later entry silently overwrite the earlier one in the fake
// scope's commands.<role> slot, so the earlier entry's own mismatch would never be checked. A
// caller fixing a proposal must see every applicable error in one round-trip, including on
// entries that are also duplicates of each other.
function checkFingerprintKeyMismatches(proposal) {
  const errors = [];
  for (const entry of proposal.scopeCommands || []) {
    const fakeScope = { commands: { custom: {} } };
    if (entry.role.startsWith("custom.")) {
      fakeScope.commands.custom[entry.role.slice("custom.".length)] = entry;
    } else {
      fakeScope.commands[entry.role] = entry;
    }
    for (const mismatch of findCommandFingerprintKeyMismatches(fakeScope)) {
      errors.push({ code: "fingerprint_key_mismatch", scopeId: entry.scopeId, role: mismatch.label, missing: mismatch.missing, extra: mismatch.extra, message: `scopeCommands entry for scope ${entry.scopeId} role ${mismatch.label}: sourceFingerprintAtSelection keys do not match sourceRefs` });
    }
  }
  return errors;
}

export function validateProposalStructure(proposal) {
  const schemaResult = validate("discovery-proposal", proposal);
  if (!schemaResult.valid) {
    return {
      ok: false,
      errors: schemaResult.errors.map((e) => ({ code: "schema_invalid", pointer: e.path, message: e.message }))
    };
  }

  const errors = [
    ...checkScanParametersRange(proposal),
    ...checkDuplicateSourceActions(proposal),
    ...checkDuplicateScopeCommands(proposal),
    ...checkDuplicateScopeKeys(proposal),
    ...checkAlternativeKeyCollisions(proposal),
    ...checkFingerprintKeyMismatches(proposal)
  ];

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function verifyWorkspaceConsistency({ proposal, planningRoot, workspaceRoot }) {
  const freshScan = runDiscoverScan({
    planningRoot,
    workspaceRoot,
    maxSourceBytes: proposal.scanParameters.maxSourceBytes
  });
  if (freshScan.baseRevision.workspaceHash !== proposal.baseRevision.workspaceHash) {
    return {
      ok: false,
      errors: [{
        code: "stale_proposal",
        message: "the workspace has changed since this proposal was generated; rescan with discover scan and resubmit",
        claimedWorkspaceHash: proposal.baseRevision.workspaceHash,
        observedWorkspaceHash: freshScan.baseRevision.workspaceHash
      }]
    };
  }
  return { ok: true, freshScan };
}

function verifyOneSourceAction(entry, { confirmedById, workspaceRoot, maxSourceBytes }) {
  if (entry.action === "add") {
    return verifyClaimedFingerprint(entry, entry.path, workspaceRoot, maxSourceBytes);
  }

  // update, move, and remove all reference an existing sourceId -- confirm it's real before
  // doing anything else. Without this, "remove" was the only action type that could target a
  // completely fictitious sourceId and pass validation (update/move already reject via
  // unknown_source_id below; remove used to skip this lookup entirely).
  const confirmed = confirmedById.get(entry.sourceId);
  if (!confirmed) {
    return [{ code: "unknown_source_id", sourceId: entry.sourceId, message: `sources[] entry references sourceId ${entry.sourceId}, which is not in the confirmed catalog` }];
  }

  if (entry.action === "remove") return []; // existence already confirmed above; no fingerprint claim to verify

  if (entry.action === "update") {
    return verifyClaimedFingerprint(entry, confirmed.path, workspaceRoot, maxSourceBytes);
  }

  // entry.action === "move"
  const errors = [];
  if (entry.fromPath !== confirmed.path) {
    errors.push({ code: "move_frompath_mismatch", sourceId: entry.sourceId, message: `move claims fromPath ${entry.fromPath}, but the confirmed catalog has this source registered at ${confirmed.path}` });
    return errors; // the rest of the move checks are meaningless if the identity claim is already wrong
  }
  let oldAbsolutePath;
  try {
    oldAbsolutePath = confineScopePath(workspaceRoot, entry.fromPath);
  } catch (error) {
    if (!(error instanceof PathConfinementError)) throw error;
    return [{ code: "untrusted_source_path", sourceId: entry.sourceId, path: entry.fromPath, message: error.message }];
  }
  if (fs.existsSync(oldAbsolutePath)) {
    errors.push({ code: "move_source_still_exists", sourceId: entry.sourceId, message: `move claims fromPath ${entry.fromPath} is now empty, but it still exists in the live workspace` });
  }
  if (entry.observedContentHash !== confirmed.confirmedContentHash) {
    errors.push({ code: "move_content_mismatch", sourceId: entry.sourceId, message: "move's claimed contentHash does not match the confirmed source's contentHash -- this is not a content-preserving move" });
  }
  errors.push(...verifyClaimedFingerprint(entry, entry.path, workspaceRoot, maxSourceBytes));
  return errors;
}

function verifyClaimedFingerprint(entry, relativePath, workspaceRoot, maxSourceBytes) {
  let absolutePath;
  try {
    absolutePath = confineScopePath(workspaceRoot, relativePath);
  } catch (error) {
    if (!(error instanceof PathConfinementError)) throw error;
    return [{ code: "untrusted_source_path", sourceId: entry.sourceId ?? null, path: relativePath, message: error.message }];
  }
  let observed;
  try {
    observed = computeSourceFingerprint(absolutePath, { maxBytes: maxSourceBytes });
  } catch (error) {
    if (!(error instanceof FingerprintError)) throw error;
    return [{ code: error.code, sourceId: entry.sourceId ?? null, path: relativePath, message: error.message }];
  }
  const errors = [];
  if (observed.fingerprint !== entry.observedFingerprint || observed.contentHash !== entry.observedContentHash) {
    errors.push({
      code: "fingerprint_mismatch",
      sourceId: entry.sourceId ?? null,
      path: relativePath,
      message: "the proposal's claimed fingerprint does not match what is actually observed in the live workspace",
      claimedFingerprint: entry.observedFingerprint,
      observedFingerprint: observed.fingerprint
    });
  }
  return errors;
}

export function verifySourceFingerprints({ proposal, planningRoot, workspaceRoot }) {
  const confirmedById = new Map(readConfirmedSources(planningRoot).map((s) => [s.id, s]));
  const errors = [];
  for (const entry of proposal.sources || []) {
    errors.push(...verifyOneSourceAction(entry, { confirmedById, workspaceRoot, maxSourceBytes: proposal.scanParameters.maxSourceBytes }));
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function resolvableSourceIds(proposal, confirmedIds) {
  const resolvable = new Set(confirmedIds);
  for (const entry of proposal.sources || []) {
    if (entry.action === "update" || entry.action === "move") resolvable.add(entry.sourceId);
    // "add" deliberately excluded -- no sourceId exists yet. "remove" needs no special-casing
    // here: a source being removed remains in confirmedIds (it still exists in the live
    // catalog at check time) and so stays resolvable by this function -- whether a NEW
    // reference to a source-being-removed should itself be rejected is a different, separate
    // check, owned by Task 8's checkRemovalReferentialIntegrity.
  }
  return resolvable;
}

export function resolveSourceReferences({ proposal, planningRoot }) {
  const confirmedIds = readConfirmedSources(planningRoot).map((s) => s.id);
  const resolvable = resolvableSourceIds(proposal, confirmedIds);
  // scopeCommands[].scopeId can only ever name an already-confirmed scope: scopes[] entries in
  // this same proposal have no id yet (minted only at apply time, same reasoning as "add" sources
  // being unreferenceable within their own proposal).
  const confirmedScopeIds = new Set(readConfirmedScopes(planningRoot).map((s) => s.id));
  const errors = [];

  for (const command of proposal.scopeCommands || []) {
    if (!confirmedScopeIds.has(command.scopeId)) {
      errors.push({ code: "dangling_scope_ref", scopeId: command.scopeId, role: command.role, message: `scopeId ${command.scopeId} does not resolve to a confirmed scope` });
    }
    for (const ref of command.sourceRefs || []) {
      if (!resolvable.has(ref)) {
        errors.push({ code: "dangling_source_ref", scopeId: command.scopeId, role: command.role, sourceId: ref, message: `sourceRef ${ref} does not resolve to a confirmed source or an update/move in this same proposal` });
      }
    }
    for (const alternative of command.alternatives || []) {
      for (const ref of alternative.sourceRefs || []) {
        if (!resolvable.has(ref)) {
          errors.push({ code: "dangling_source_ref", scopeId: command.scopeId, role: command.role, sourceId: ref, message: `alternative sourceRef ${ref} does not resolve to a confirmed source or an update/move in this same proposal` });
        }
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function checkDriftReconciliation({ proposal, freshScan }) {
  const errors = [];

  const addressedSourceIds = new Set((proposal.sources || []).filter((e) => e.action !== "add").map((e) => e.sourceId));
  for (const known of freshScan.knownSources) {
    if (known.driftState === "unchanged") continue;
    if (!addressedSourceIds.has(known.sourceId)) {
      errors.push({ code: "unreconciled_source_drift", sourceId: known.sourceId, driftState: known.driftState, message: `source ${known.sourceId} has unreconciled drift (${known.driftState}) and is not addressed by any sources[] action in this proposal` });
    }
  }

  const addressedCommands = new Set((proposal.scopeCommands || []).map((c) => `${c.scopeId}:${c.role}`));
  // Fail closed like the source-drift check above: only these two states are known-fine and
  // skip reconciliation. Any other value -- including one not yet invented -- blocks by default,
  // rather than an allowlist of "bad" states that a future evidenceState could silently bypass.
  const NO_RECONCILIATION_NEEDED = new Set(["current", "not-evidence-backed"]);
  for (const evidence of freshScan.knownCommandsEvidence) {
    if (NO_RECONCILIATION_NEEDED.has(evidence.evidenceState)) continue;
    if (!addressedCommands.has(`${evidence.scopeId}:${evidence.role}`)) {
      errors.push({ code: "unreconciled_command_evidence", scopeId: evidence.scopeId, role: evidence.role, evidenceState: evidence.evidenceState, message: `command ${evidence.scopeId}/${evidence.role} has unreconciled evidence (${evidence.evidenceState}) and is not addressed by any scopeCommands[] entry in this proposal` });
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function allProposalSourceRefs(proposal) {
  const refs = new Set();
  for (const command of proposal.scopeCommands || []) {
    for (const ref of command.sourceRefs || []) refs.add(ref);
    for (const alternative of command.alternatives || []) {
      for (const ref of alternative.sourceRefs || []) refs.add(ref);
    }
  }
  return refs;
}

function confirmedSourceRefsExcludingTouchedCommands(planningRoot, touchedCommandKeys) {
  const refs = new Set();
  for (const scope of readConfirmedScopes(planningRoot)) {
    for (const { role, entry } of allCommandEntries(scope)) {
      if (touchedCommandKeys.has(`${scope.id}:${role}`)) continue; // this proposal already reconciles it
      for (const ref of entry.sourceRefs || []) refs.add(ref);
      for (const alternative of entry.alternatives || []) {
        for (const ref of alternative.sourceRefs || []) refs.add(ref);
      }
    }
  }
  return refs;
}

export function checkRemovalReferentialIntegrity({ proposal, planningRoot }) {
  const removedIds = (proposal.sources || []).filter((e) => e.action === "remove").map((e) => e.sourceId);
  if (removedIds.length === 0) return { ok: true };

  const inThisProposal = allProposalSourceRefs(proposal);
  const touchedCommandKeys = new Set((proposal.scopeCommands || []).map((c) => `${c.scopeId}:${c.role}`));
  const inConfirmedCatalog = confirmedSourceRefsExcludingTouchedCommands(planningRoot, touchedCommandKeys);

  const errors = [];
  for (const sourceId of removedIds) {
    if (inThisProposal.has(sourceId) || inConfirmedCatalog.has(sourceId)) {
      errors.push({ code: "remove_still_referenced", sourceId, message: `source ${sourceId} is marked for removal but is still referenced by a command (either in this proposal or the confirmed catalog)` });
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function checkScopeProposals({ proposal, planningRoot, workspaceRoot }) {
  const errors = [];
  const confirmedKeys = new Set(readConfirmedScopes(planningRoot).map((s) => s.key));
  for (const entry of proposal.scopes || []) {
    if (confirmedKeys.has(entry.key)) {
      errors.push({ code: "scope_key_collision", key: entry.key, message: `scopes[] entry key ${entry.key} already exists in the confirmed scope catalog` });
    }
    try {
      confineScopePath(workspaceRoot, entry.path);
    } catch (error) {
      if (!(error instanceof PathConfinementError)) throw error;
      errors.push({ code: "untrusted_scope_path", key: entry.key, path: entry.path, message: error.message });
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// After this proposal is applied, no two sources may occupy the same path -- an "add" or "move"
// landing on a path that's already occupied (by an untouched confirmed source, or by another
// add/move in this same proposal) would break detectMoved's "exactly one match" uniqueness rule
// in every subsequent scan.
export function checkSourcePathCollisions({ proposal, planningRoot, workspaceRoot = path.dirname(planningRoot) }) {
  const displaced = new Set((proposal.sources || []).filter((e) => e.action === "move" || e.action === "remove").map((e) => e.sourceId));
  const occupants = new Map();
  const occupy = (relativePath, sourceId) => {
    let identity;
    try {
      // Catalog paths are semantic workspace locations, not opaque labels. Resolve lexical
      // variants and existing in-workspace symlinks so aliases cannot evade uniqueness checks.
      identity = confineScopePath(workspaceRoot, relativePath);
    } catch (error) {
      if (!(error instanceof PathConfinementError)) throw error;
      // Other step-4 checks report the untrusted path. Keep this check total so one bad path
      // does not prevent the remaining independent validation errors from being collected.
      identity = `untrusted:${relativePath}`;
    }
    if (!occupants.has(identity)) occupants.set(identity, []);
    occupants.get(identity).push({ sourceId, path: relativePath });
  };

  for (const source of readConfirmedSources(planningRoot)) {
    if (displaced.has(source.id)) continue; // no longer occupies its old path after this proposal
    occupy(source.path, source.id);
  }
  for (const entry of proposal.sources || []) {
    if (entry.action === "add") occupy(entry.path, null);
    if (entry.action === "move") occupy(entry.path, entry.sourceId);
  }

  const errors = [];
  for (const entries of occupants.values()) {
    if (entries.length > 1) {
      const paths = [...new Set(entries.map((entry) => entry.path))];
      errors.push({
        code: "source_path_collision",
        path: paths[0],
        paths,
        message: `more than one source would occupy the same workspace path after this proposal is applied: ${paths.join(", ")}`
      });
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateDiscoveryProposal({ proposal, planningRoot, workspaceRoot }) {
  const structure = validateProposalStructure(proposal);
  if (!structure.ok) return structure;

  const consistency = verifyWorkspaceConsistency({ proposal, planningRoot, workspaceRoot });
  if (!consistency.ok) return consistency;
  const { freshScan } = consistency;

  const fingerprints = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  const references = resolveSourceReferences({ proposal, planningRoot });
  const drift = checkDriftReconciliation({ proposal, freshScan });
  const removal = checkRemovalReferentialIntegrity({ proposal, planningRoot });
  const scopeProposals = checkScopeProposals({ proposal, planningRoot, workspaceRoot });
  const pathCollisions = checkSourcePathCollisions({ proposal, planningRoot, workspaceRoot });

  const stepFourErrors = [
    ...(fingerprints.ok ? [] : fingerprints.errors),
    ...(references.ok ? [] : references.errors),
    ...(drift.ok ? [] : drift.errors),
    ...(removal.ok ? [] : removal.errors),
    ...(scopeProposals.ok ? [] : scopeProposals.errors),
    ...(pathCollisions.ok ? [] : pathCollisions.errors)
  ];
  if (stepFourErrors.length > 0) return { ok: false, errors: stepFourErrors };

  return {
    ok: true,
    normalized: {
      proposal,
      verifiedAt: new Date().toISOString(),
      workspaceHash: freshScan.baseRevision.workspaceHash,
      scanParameters: freshScan.scanParameters
    }
  };
}
