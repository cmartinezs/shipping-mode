import { generateUuidV7 } from "../lib/ids.mjs";
import { UsageError } from "../lib/errors.mjs";
import { detectGit, enumerateCandidates, computeKnownSourceDrift, computeCommandEvidence, computeWorkspaceHash } from "../lib/discoverScan.mjs";

const DEFAULT_MAX_SOURCE_BYTES = 536870912; // 512 MiB
const MIN_MAX_SOURCE_BYTES = 1048576; // 1 MiB
const MAX_MAX_SOURCE_BYTES = 2147483648; // 2 GiB

export function runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES }) {
  if (maxSourceBytes < MIN_MAX_SOURCE_BYTES || maxSourceBytes > MAX_MAX_SOURCE_BYTES) {
    throw new UsageError(`--max-source-bytes must be between ${MIN_MAX_SOURCE_BYTES} and ${MAX_MAX_SOURCE_BYTES}, got ${maxSourceBytes}`);
  }

  const git = detectGit(workspaceRoot);
  const { scopeCandidates, sourceCandidates: rawSourceCandidates, diagnostics: enumerationDiagnostics } = enumerateCandidates(workspaceRoot);
  const {
    results: knownSources,
    diagnostics: driftDiagnostics,
    fingerprintedSourceCandidates
  } = computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates: rawSourceCandidates, maxSourceBytes });
  const knownCommandsEvidence = computeCommandEvidence({ planningRoot, knownSourceDrift: knownSources });

  const diagnostics = [...enumerationDiagnostics, ...driftDiagnostics];
  const workspaceHash = computeWorkspaceHash({
    scopeCandidates,
    sourceCandidates: fingerprintedSourceCandidates,
    knownSources,
    knownCommandsEvidence
  });

  return {
    schemaVersion: 1,
    scanId: generateUuidV7(),
    generatedAt: new Date().toISOString(),
    baseRevision: { vcsRevision: git.enabled ? `git:${git.revision}` : "none", workspaceHash },
    scanParameters: { maxSourceBytes },
    git,
    scopeCandidates,
    sourceCandidates: fingerprintedSourceCandidates,
    knownSources,
    knownCommandsEvidence,
    diagnostics
  };
}
