import { validate } from "./schema.mjs";
import { findCommandFingerprintKeyMismatches, MIN_MAX_SOURCE_BYTES, MAX_MAX_SOURCE_BYTES } from "./discoverScan.mjs";

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
      errors: schemaResult.errors.map((e) => ({ code: "schema_invalid", path: e.path, message: e.message }))
    };
  }

  const errors = [
    ...checkScanParametersRange(proposal),
    ...checkDuplicateSourceActions(proposal),
    ...checkDuplicateScopeCommands(proposal),
    ...checkFingerprintKeyMismatches(proposal)
  ];

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
