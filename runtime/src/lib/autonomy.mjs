import fs from "node:fs";
import { revisionHash } from "./canonical.mjs";
import { parseYaml } from "./yaml.mjs";
import { confineRuntimeWritePath } from "./paths.mjs";
import { readConfirmedSources } from "./discoverScan.mjs";

export const REASON_CODES = Object.freeze({
  FAMILY_NOT_ALLOWLISTED: "family_not_allowlisted",
  AUTHORITY_ABOVE_CEILING: "authority_above_ceiling",
  AUTHORITY_ESCALATION: "authority_escalation",
  LOW_CONFIDENCE: "low_confidence",
  ALTERNATIVES_PRESENT: "alternatives_present",
  DESTRUCTIVE_ACTION: "destructive_action",
  NEW_SCOPE_ALWAYS_PAUSES: "new_scope_always_pauses",
  DEFAULT_PAUSE: "default_pause",
  AUTONOMY_CONFIG_CHANGE: "autonomy_config_change",
  POLICY_CHANGED_SINCE_VALIDATION: "policy_changed_since_validation"
});

export const AUTOMATION_CAPABLE_ACTORS = new Set(["system:automation:discovery", "discovery-skill"]);

export const DEFAULT_AUTONOMY_POLICY = Object.freeze({
  discovery: {
    default: "pause",
    scopeCommandConfidenceFloor: "high",
    sourceOverrides: [],
    scopeCommand: { mode: "pause" }
  }
});

const STANDING_ORDER = { contextual: 0, supporting: 1, authoritative: 2 };
const FORCE_ORDER = { unknown: 0, informational: 1, advisory: 2, normative: 3 };
const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeAutonomyPolicy(policy = null) {
  const discovery = policy?.discovery || DEFAULT_AUTONOMY_POLICY.discovery;
  return {
    discovery: {
      default: discovery.default,
      scopeCommandConfidenceFloor: discovery.scopeCommandConfidenceFloor,
      sourceOverrides: [...(discovery.sourceOverrides || [])].map((entry) => ({
        family: entry.family,
        mode: entry.mode,
        ...(entry.authorityCeiling ? { authorityCeiling: { ...entry.authorityCeiling } } : {})
      })).sort((a, b) => a.family.localeCompare(b.family)),
      scopeCommand: { mode: discovery.scopeCommand?.mode || "pause" }
    }
  };
}

export function readCurrentConfig(planningRoot) {
  const configPath = confineRuntimeWritePath(planningRoot, "config.yml");
  return fs.existsSync(configPath) ? parseYaml(fs.readFileSync(configPath, "utf8")) : null;
}

export function readConfirmedAutonomyPolicy(planningRoot) {
  return normalizeAutonomyPolicy(readCurrentConfig(planningRoot)?.autonomy || null);
}

export function policyFingerprint(policy) {
  return revisionHash(normalizeAutonomyPolicy(policy));
}

export function currentPolicyFingerprint(planningRoot) {
  return policyFingerprint(readConfirmedAutonomyPolicy(planningRoot));
}

export function autonomyConfigChangeEvaluation(planningRoot) {
  return {
    policyFingerprint: currentPolicyFingerprint(planningRoot),
    autoApprovable: false,
    blockedBy: [{ itemRef: "changeSet", reason: REASON_CODES.AUTONOMY_CONFIG_CHANGE }]
  };
}

export function isAutomationCapableActor(actor) {
  return AUTOMATION_CAPABLE_ACTORS.has(actor);
}

function sourceOverrideFor(policy, family) {
  return policy.discovery.sourceOverrides.find((entry) => entry.family === family) || null;
}

function authorityWithinCeiling(authority, ceiling) {
  return STANDING_ORDER[authority.standing] <= STANDING_ORDER[ceiling.standing]
    && FORCE_ORDER[authority.force] <= FORCE_ORDER[ceiling.force];
}

function authorityEscalated(previousAuthority, nextAuthority) {
  return STANDING_ORDER[nextAuthority.standing] > STANDING_ORDER[previousAuthority.standing]
    || FORCE_ORDER[nextAuthority.force] > FORCE_ORDER[previousAuthority.force];
}

function sourceStateFor(entry, confirmedSources) {
  const existing = entry.sourceId ? confirmedSources.find((source) => source.id === entry.sourceId) : null;
  return {
    existing,
    family: entry.family || existing?.family,
    authority: entry.authority || existing?.authority
  };
}

function block(blockedBy, itemRef, reason) {
  blockedBy.push({ itemRef, reason });
}

export function evaluateSourceAction({ entry, index, policy, confirmedSources }) {
  const itemRef = `sources[${index}]`;
  const blockedBy = [];
  if (entry.action === "move" || entry.action === "remove") {
    block(blockedBy, itemRef, REASON_CODES.DESTRUCTIVE_ACTION);
    return blockedBy;
  }

  const state = sourceStateFor(entry, confirmedSources);
  const override = sourceOverrideFor(policy, state.family);
  if (!override) {
    block(blockedBy, itemRef, REASON_CODES.FAMILY_NOT_ALLOWLISTED);
    return blockedBy;
  }
  if (override.mode === "pause") {
    block(blockedBy, itemRef, REASON_CODES.DEFAULT_PAUSE);
    return blockedBy;
  }
  if (entry.action === "update" && state.existing && entry.authority && authorityEscalated(state.existing.authority, state.authority)) {
    block(blockedBy, itemRef, REASON_CODES.AUTHORITY_ESCALATION);
  }
  if (!authorityWithinCeiling(state.authority, override.authorityCeiling)) {
    block(blockedBy, itemRef, REASON_CODES.AUTHORITY_ABOVE_CEILING);
  }
  return blockedBy;
}

export function evaluateScopeProposal({ index }) {
  return [{ itemRef: `scopes[${index}]`, reason: REASON_CODES.NEW_SCOPE_ALWAYS_PAUSES }];
}

export function evaluateScopeCommand({ entry, policy }) {
  const blockedBy = [];
  const itemRef = `scopeCommands[${entry.scopeId}].${entry.role}`;
  if (policy.discovery.scopeCommand.mode !== "auto-approve") {
    block(blockedBy, itemRef, REASON_CODES.DEFAULT_PAUSE);
    return blockedBy;
  }
  if (CONFIDENCE_ORDER[entry.confidence] < CONFIDENCE_ORDER[policy.discovery.scopeCommandConfidenceFloor]) {
    block(blockedBy, itemRef, REASON_CODES.LOW_CONFIDENCE);
  }
  if ((entry.alternatives || []).length > 0) {
    block(blockedBy, itemRef, REASON_CODES.ALTERNATIVES_PRESENT);
  }
  return blockedBy;
}

export function evaluateDiscoveryProposalAutonomy({ proposal, policy, confirmedSources }) {
  const normalizedPolicy = normalizeAutonomyPolicy(policy);
  const blockedBy = [];
  for (const [index, entry] of (proposal.scopes || []).entries()) {
    blockedBy.push(...evaluateScopeProposal({ index }));
  }
  for (const [index, entry] of (proposal.sources || []).entries()) {
    blockedBy.push(...evaluateSourceAction({ entry, index, policy: normalizedPolicy, confirmedSources }));
  }
  for (const entry of proposal.scopeCommands || []) {
    blockedBy.push(...evaluateScopeCommand({ entry, policy: normalizedPolicy }));
  }
  return {
    policyFingerprint: policyFingerprint(normalizedPolicy),
    autoApprovable: blockedBy.length === 0,
    blockedBy
  };
}

export function evaluateChangeSetAutonomy({ changeSet, planningRoot, policy = readConfirmedAutonomyPolicy(planningRoot) }) {
  if (changeSet.kind === "config.autonomy.set") {
    return {
      policyFingerprint: policyFingerprint(policy),
      autoApprovable: false,
      blockedBy: [{ itemRef: "changeSet", reason: REASON_CODES.AUTONOMY_CONFIG_CHANGE }]
    };
  }
  if (changeSet.kind !== "discovery.propose") return null;
  return evaluateDiscoveryProposalAutonomy({
    proposal: changeSet.payload.proposal,
    policy,
    confirmedSources: readConfirmedSources(planningRoot)
  });
}

export function clonePolicy(policy) {
  return clone(normalizeAutonomyPolicy(policy));
}
