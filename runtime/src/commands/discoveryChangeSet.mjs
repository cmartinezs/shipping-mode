import path from "node:path";
import { validateDiscoveryProposal } from "../lib/discoveryProposal.mjs";
import { generateUuidV7 } from "../lib/ids.mjs";
import { propose } from "../lib/changeset.mjs";
import { UsageError } from "../lib/errors.mjs";

function parseProposalText(proposalText) {
  try {
    return JSON.parse(proposalText);
  } catch (error) {
    throw new UsageError(`invalid proposal JSON: ${error.message}`);
  }
}

function assignmentForSource(index) {
  return { sourceActionIndex: index, sourceId: generateUuidV7() };
}

function assignmentForScope(index) {
  return { scopeIndex: index, scopeId: generateUuidV7() };
}

export function prepareDiscoveryChangeSet({ planningRoot, workspaceRoot, proposalText, actor, operationId = generateUuidV7(), confirmedAt = new Date().toISOString() }) {
  const proposal = parseProposalText(proposalText);
  const validation = validateDiscoveryProposal({ proposal, planningRoot, workspaceRoot });
  if (!validation.ok) return { ok: false, status: "INVALID", errors: validation.errors };

  const sourceIdAssignments = (proposal.sources || [])
    .map((entry, index) => entry.action === "add" ? assignmentForSource(index) : null)
    .filter(Boolean);
  const scopeIdAssignments = (proposal.scopes || []).map((_, index) => assignmentForScope(index));
  const targetFiles = new Set();
  if ((proposal.scopes || []).length > 0) targetFiles.add("config.yml");

  for (const [index, entry] of (proposal.sources || []).entries()) {
    const assigned = sourceIdAssignments.find((candidate) => candidate.sourceActionIndex === index);
    const sourceId = assigned?.sourceId || entry.sourceId;
    targetFiles.add(`sources/${sourceId}/source.yml`);
  }
  for (const assignment of scopeIdAssignments) {
    targetFiles.add(`scopes/${assignment.scopeId}/scope.yml`);
  }
  for (const entry of proposal.scopeCommands || []) {
    targetFiles.add(`scopes/${entry.scopeId}/scope.yml`);
  }

  return {
    ok: true,
    operationId,
    kind: "discovery.propose",
    targetFiles: [...targetFiles].sort(),
    preconditions: {
      discoveryWorkspace: {
        workspaceHash: validation.normalized.workspaceHash,
        scanParameters: validation.normalized.scanParameters
      }
    },
    payload: {
      operationId,
      proposal,
      sourceIdAssignments,
      scopeIdAssignments,
      confirmedBy: actor,
      confirmedAt
    }
  };
}

export function runDiscoveryPropose({ planningRoot, workspaceRoot, proposalText, actor }) {
  const prepared = prepareDiscoveryChangeSet({ planningRoot, workspaceRoot, proposalText, actor });
  if (!prepared.ok) return prepared;
  const operationsRoot = path.join(planningRoot, "operations");
  const operationId = propose({
    operationsRoot,
    planningRoot,
    kind: prepared.kind,
    target: {},
    payload: prepared.payload,
    targetFiles: prepared.targetFiles,
    actor,
    operationId: prepared.operationId,
    proposedAt: prepared.payload.confirmedAt,
    preconditions: prepared.preconditions
  });
  return { operationId };
}
