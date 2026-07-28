import assert from "node:assert/strict";
import { validate } from "../schema.mjs";
import { DIRECTORY_CONTENT_HASH } from "../bootstrapTopology.mjs";

const cases = {
  config: {
    valid: {
      schemaVersion: 1,
      name: "demo",
      baseBranch: null,
      vcs: "none",
      git: { enabled: false, provider: "none" },
      work_sources: [],
      project: { name: "demo", type: "software" },
      plugin: { schemaVersion: 1, launcher: "shipping-mode" },
      policies: {
        release: { mode: "strict_sequence", defaultLane: "main" },
        workSources: { defaultSyncMode: "import_only", defaultSourcePolicy: "import_snapshot", externalWrites: "approval_required" },
        paths: { workspaceBoundary: "current_directory" }
      },
      scopeCatalog: { directory: ".planning/scopes", enabled: [] },
      runtime: {
        eventStore: ".planning/events",
        operationStore: ".planning/operations",
        runtimeStore: ".planning/.runtime",
        templateVendor: ".planning/vendor/template-packs",
        operationRetentionDays: 7,
        retainFailedOperations: true,
        retainBeforeSnapshots: false,
        eventRetention: "permanent"
      },
      scopeRefs: [],
      documentation: { source_refs: [], gaps: [] }
    },
    invalid: { schemaVersion: 1, name: "", vcs: "none", scopeRefs: [] }
  },
  "plugin-lock": {
    valid: {
      schemaVersion: 1,
      pluginVersion: "1.0.0",
      templatePackFingerprint: `sha256:${"a".repeat(64)}`,
      plugin: {
        version: "1.0.0",
        schemaVersion: 1,
        templatePack: {
          id: "default",
          version: "1.0.0",
          fingerprint: `sha256:${"a".repeat(64)}`,
          vendorSnapshot: `.planning/vendor/template-packs/sha256-${"a".repeat(64)}`
        }
      }
    },
    invalid: { schemaVersion: 1, pluginVersion: "1.0.0" }
  },
  scope: {
    valid: { schemaVersion: 1, id: "018f0000-0000-7000-8000-000000000000", key: "backend", label: "Backend", kind: "code", path: "api/", owner: null },
    invalid: { schemaVersion: 1, id: "not-a-uuid", key: "Backend", label: "Backend", kind: "code", path: "api/" }
  },
  guide: {
    valid: {
      schemaVersion: 1,
      dslVersion: 1,
      id: "018f0000-0000-7000-8000-000000000020",
      scopeId: "018f0000-0000-7000-8000-000000000021",
      kind: "task",
      revision: `sha256:${"a".repeat(64)}`,
      sourceRefs: ["018f0000-0000-7000-8000-000000000010"],
      provenance: { sourceMapRevision: "a".repeat(64), generationMethod: "generic", generatorVersion: "test", generatorFingerprint: null, generationInputHash: "c".repeat(64), generationOutputHash: "d".repeat(64), model: null, promptVersion: null, generatedAt: "2026-07-27T00:00:00Z", sourceFingerprints: { "018f0000-0000-7000-8000-000000000010": "b".repeat(64) } },
      workPackageTypes: [], taskTypes: [], requiredSections: [], requiredGateRefs: [], templateRefs: [], decompositionRules: [], automation: { fallback: "markGaps" },
      openGaps: []
    },
    invalid: { schemaVersion: 1, id: "not-a-uuid", scopeId: "not-a-uuid", kind: "task", status: "approved" }
  },
  "change-set": {
    valid: {
      schemaVersion: 1, operationId: "018f0000-0000-7000-8000-000000000000", kind: "workspace.init", target: {},
      baseRevisions: {}, hash: "a".repeat(64),
      payload: { name: "demo", baseBranch: null, vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` }
    },
    invalid: {
      schemaVersion: 1, operationId: "018f0000-0000-7000-8000-000000000000", kind: "workspace.init", target: {},
      baseRevisions: {}, hash: "a".repeat(64),
      payload: { name: "demo" } // missing vcs/pluginVersion/templatePackFingerprint, required for this kind
    }
  },
  operation: {
    valid: {
      id: "018f0000-0000-7000-8000-000000000000", kind: "workspace.init", status: "PROPOSED", proposedBy: "carlos", proposedAt: "2026-07-24T00:00:00.000Z",
      reservedEvents: [{ eventId: "018f0000-0000-7000-8000-000000000001", type: "workspace.initialized" }], history: []
    },
    invalid: {
      id: "018f0000-0000-7000-8000-000000000000", kind: "workspace.init", status: "REJECTED", proposedBy: "carlos", proposedAt: "2026-07-24T00:00:00.000Z",
      reservedEvents: [{ eventId: "018f0000-0000-7000-8000-000000000001", type: "workspace.initialized" }], history: []
    }
  },
  event: {
    valid: { eventId: "018f0000-0000-7000-8000-000000000000", schemaVersion: 1, type: "workspace.initialized", aggregate: { type: "workspace", id: "018f0000-0000-7000-8000-000000000000" }, occurredAt: "2026-07-24T00:00:00.000Z", actor: "carlos", operationId: "018f0000-0000-7000-8000-000000000000", idempotencyKey: "k1", payload: {} },
    invalid: { eventId: "018f0000-0000-7000-8000-000000000000", schemaVersion: 1, type: "workspace.initialized", occurredAt: "2026-07-24T00:00:00.000Z", actor: "carlos", operationId: "018f0000-0000-7000-8000-000000000000", idempotencyKey: "k1", payload: {} }
  },
  result: {
    valid: { operationId: "018f0000-0000-7000-8000-000000000000", files: [{ target: "config.yml", action: "write", contentHash: "a".repeat(64) }] },
    invalid: { operationId: "018f0000-0000-7000-8000-000000000000", files: [{ target: "config.yml" }] }
  }
};

const validGitPolicy = {
  enabled: true,
  provider: "github",
  branches: { work_base: "develop", integration: "develop", production: "master" },
  work: { branch_unit: "work_package", branch_pattern: "<type>/<slug>", reuse: "within_work_package" },
  worktrees: { mode: "optional", unit: "work_package", cleanup: "after_integration" },
  commits: { granularity: "task", message_policy: "host_defined" },
  pull_requests: {
    enabled: true,
    work_target: "develop",
    draft_by_default: true,
    merge_strategy: "provider_default",
    promotion: { source: "develop", target: "master" }
  },
  automation: {
    create_branch: "allowed",
    create_worktree: "allowed",
    commit: "allowed",
    push: "approval_required",
    create_pr: "approval_required",
    merge_pr: "approval_required"
  }
};
const validWorkSources = [
  { id: "local-backlog", provider: "local_repository", enabled: true, roots: ["docs/backlog/"], source_policy: "import_snapshot", sync_mode: "import_only" },
  { id: "jira-gradeops", provider: "jira", enabled: false, transport: "mcp", source_policy: "external_authoritative", sync_mode: "pull", mcp_connection_ref: "atlassian" }
];
const validDocumentation = {
  source_refs: ["018f0000-0000-7000-8000-000000000010"],
  gaps: [{ id: "018f0000-0000-7000-8000-000000000011", concern: "guides", status: "missing", description: "scope guide is pending", scope_ref: "018f0000-0000-7000-8000-000000000012" }]
};
assert.equal(validate("config", { ...cases.config.valid, git: validGitPolicy, work_sources: validWorkSources }).valid, true, "closed Git and Work Source config must pass");
assert.equal(validate("config", { ...cases.config.valid, documentation: validDocumentation }).valid, true, "documentation refs and gaps must pass");
assert.equal(validate("config", { ...cases.config.valid, documentation: { source_refs: [], gaps: [{ ...validDocumentation.gaps[0], owner: "unapproved" }] } }).valid, false, "documentation gaps must remain closed");
assert.equal(validate("config", { ...cases.config.valid, git: { enabled: false, provider: "github" } }).valid, false, "disabled Git cannot use a provider");
assert.equal(validate("config", { ...cases.config.valid, work_sources: [{ ...validWorkSources[0], api_token: "secret" }] }).valid, false, "Work Source secrets must be rejected");
assert.equal(validate("config", { ...cases.config.valid, work_sources: [{ ...validWorkSources[1], mcp_connection_ref: "bad ref" }] }).valid, false, "connection refs must be opaque identifiers");
const missingGit = structuredClone(cases.config.valid);
delete missingGit.git;
assert.equal(validate("config", missingGit).valid, false, "git is canonical and required");
const missingWorkSources = structuredClone(cases.config.valid);
delete missingWorkSources.work_sources;
assert.equal(validate("config", missingWorkSources).valid, false, "work_sources is canonical and required");


const taskGuideFixture = structuredClone(cases.guide.valid);
const mixedTaskGuide = { ...taskGuideFixture, commandRefs: [] };
assert.equal(validate("guide", mixedTaskGuide).valid, false, "task Guide must reject test-only fields");
const arbitraryTypedObject = structuredClone(taskGuideFixture);
arbitraryTypedObject.workPackageTypes = [{ id: "x", appliesWhen: { field: "item.when", op: "equals", value: { type: "date", value: "not-a-date" } }, requiredSections: ["x"], requiredGateRefs: ["x"] }];
assert.equal(validate("guide", arbitraryTypedObject).valid, false, "typed date values must use the closed valid representation");
const missingRegexPolicy = structuredClone(taskGuideFixture);
missingRegexPolicy.workPackageTypes = [{ id: "x", appliesWhen: { field: "item.kind", op: "matches", value: "^x" }, requiredSections: ["x"], requiredGateRefs: ["x"] }];
assert.equal(validate("guide", missingRegexPolicy).valid, false, "matches must declare its execution policy");

for (const [schemaName, { valid, invalid }] of Object.entries(cases)) {
  const validResult = validate(schemaName, valid);
  assert.equal(validResult.valid, true, `${schemaName} valid fixture must pass: ${JSON.stringify(validResult.errors)}`);
  const invalidResult = validate(schemaName, invalid);
  assert.equal(invalidResult.valid, false, `${schemaName} invalid fixture must fail`);
}

// operation lifecycle metadata is state-owned and mandatory, not optional
// metadata merely constrained when present.
const opBase = {
  id: "018f0000-0000-7000-8000-000000000000",
  kind: "workspace.init",
  proposedBy: "carlos",
  proposedAt: "2026-07-24T00:00:00.000Z",
  reservedEvents: [{ eventId: "018f0000-0000-7000-8000-000000000001", type: "workspace.initialized" }],
  history: []
};
const validation = { validatedAt: "2026-07-24T00:00:01.000Z", changeSetHash: "a".repeat(64), errors: [] };
const approval = { actor: "carlos", approvedAt: "2026-07-24T00:00:02.000Z", changeSetHash: "a".repeat(64), selfApproval: true, mode: "human" };
const filePlan = [{ target: "config.yml", action: "write", stagedRelativePath: "config.yml", expectedBefore: "ABSENT", beforeContentHash: "ABSENT", beforeRevisionHash: "ABSENT", stagedContentHash: "b".repeat(64), stagedRevisionHash: "c".repeat(64) }];
const expectedEvents = [{ eventId: "018f0000-0000-7000-8000-000000000001", relativePath: "2026/07/018f0000-0000-7000-8000-000000000001.json", contentHash: "d".repeat(64), document: {} }];

const lifecycleInvalid = [
  { ...opBase, status: "VALIDATED" },
  { ...opBase, status: "APPROVED", validation },
  { ...opBase, status: "APPLYING", approval, filePlan, expectedEvents },
  { ...opBase, status: "APPLYING", validation, filePlan, expectedEvents },
  { ...opBase, status: "RECOVERY_REQUIRED" },
  { ...opBase, status: "RECOVERY_REQUIRED", conflict: null }
];
for (const fixture of lifecycleInvalid) {
  const result = validate("operation", fixture);
  assert.equal(result.valid, false, `operation ${fixture.status} fixture missing required state metadata must fail`);
}

const discoveryChangeSet = {
  schemaVersion: 1,
  operationId: "018f0000-0000-7000-8000-000000000000",
  kind: "discovery.propose",
  target: {},
  baseRevisions: {},
  preconditions: { discoveryWorkspace: { workspaceHash: "a".repeat(64), scanParameters: { maxSourceBytes: 1048576 } } },
  payload: {
    operationId: "018f0000-0000-7000-8000-000000000000",
    proposal: { schemaVersion: 1 },
    sourceIdAssignments: [{ sourceActionIndex: 0, sourceId: "018f0000-0000-7000-8000-000000000002" }],
    scopeIdAssignments: [{ scopeIndex: 0, scopeId: "018f0000-0000-7000-8000-000000000003", guideGapId: "018f0000-0000-7000-8000-000000000004" }],
    confirmedBy: "carlos",
    confirmedAt: "2026-07-24T00:00:00.000Z"
  },
  hash: "a".repeat(64)
};
assert.equal(validate("change-set", discoveryChangeSet).valid, true, "discovery.propose fixture must pass");
assert.equal(validate("change-set", { ...discoveryChangeSet, preconditions: undefined }).valid, false, "discovery.propose requires discovery workspace preconditions");

const scopeCommandSetChangeSet = {
  schemaVersion: 1,
  operationId: "018f0000-0000-7000-8000-000000000000",
  kind: "scope.command.set",
  target: {},
  baseRevisions: {},
  payload: {
    operationId: "018f0000-0000-7000-8000-000000000000",
    scopeId: "018f0000-0000-7000-8000-000000000003",
    role: "custom.e2e",
    command: "npm run test:e2e",
    requiresEnvironment: true,
    requiresSecrets: false,
    declaredBy: "carlos",
    declaredAt: "2026-07-24T00:00:00.000Z"
  },
  hash: "a".repeat(64)
};
assert.equal(validate("change-set", scopeCommandSetChangeSet).valid, true, "scope.command.set fixture must pass");

const autonomyEvaluation = {
  operationId: discoveryChangeSet.operationId,
  changeSetHash: "a".repeat(64),
  policyFingerprint: "b".repeat(64),
  autoApprovable: true,
  blockedBy: []
};
const validatedDiscoveryOperation = {
  ...opBase,
  kind: "discovery.propose",
  status: "VALIDATED",
  validation,
  autonomyEvaluation
};
assert.equal(validate("operation", validatedDiscoveryOperation).valid, true, "validated discovery operation requires a bound autonomyEvaluation");
assert.equal(validate("operation", { ...validatedDiscoveryOperation, autonomyEvaluation: { policyFingerprint: "b".repeat(64), autoApprovable: true, blockedBy: [] } }).valid, false, "unbound autonomyEvaluation must fail schema validation");

const deleteFilePlanOperation = {
  ...opBase,
  status: "APPLYING",
  validation,
  approval,
  filePlan: [{ target: "sources/018f0000-0000-7000-8000-000000000002/source.yml", action: "delete", expectedBefore: "PRESENT", beforeContentHash: "a".repeat(64), beforeRevisionHash: "b".repeat(64), stagedContentHash: "ABSENT", stagedRevisionHash: "ABSENT" }],
  expectedEvents
};
assert.equal(validate("operation", deleteFilePlanOperation).valid, true, "delete filePlan entries must be schema-valid");
assert.equal(validate("result", { operationId: opBase.id, files: [{ target: "sources/018f0000-0000-7000-8000-000000000002/source.yml", action: "delete", contentHash: "ABSENT" }] }).valid, true, "delete result entries must be schema-valid");

const mkdirFilePlanOperation = {
  ...opBase,
  status: "APPLYING",
  validation,
  approval,
  filePlan: [{ target: "vendor/template-packs", action: "mkdir", expectedBefore: "ABSENT", beforeContentHash: "ABSENT", beforeRevisionHash: "ABSENT", stagedContentHash: DIRECTORY_CONTENT_HASH, stagedRevisionHash: DIRECTORY_CONTENT_HASH }],
  expectedEvents
};
assert.equal(validate("operation", mkdirFilePlanOperation).valid, true, "mkdir filePlan entries must be schema-valid");
const forgedMkdirOperation = structuredClone(mkdirFilePlanOperation);
forgedMkdirOperation.filePlan[0].stagedContentHash = "d".repeat(64);
assert.equal(validate("operation", forgedMkdirOperation).valid, false, "mkdir stagedContentHash is server-owned and must not be forgeable");
assert.equal(validate("result", { operationId: opBase.id, files: [{ target: "vendor/template-packs", action: "mkdir", contentHash: DIRECTORY_CONTENT_HASH }] }).valid, true, "mkdir result entries must carry the canonical directory marker");
assert.equal(validate("result", { operationId: opBase.id, files: [{ target: "vendor/template-packs", action: "mkdir", contentHash: "d".repeat(64) }] }).valid, false, "mkdir result entries must reject arbitrary content hashes");

console.log(`schema fixtures: valid/invalid cases behave correctly for all ${Object.keys(cases).length} schemas, including kind-conditional payloads and operation state invariants`);

// Corte 1 Guide metadata: approval is explicit and only legal for approved state.
{
  const scopeWithGuide = structuredClone(cases.scope.valid);
  scopeWithGuide.guides = {
    task: {
      id: "018f0000-0000-7000-8000-000000000091",
      scopeId: scopeWithGuide.id,
      kind: "task",
      status: "generated",
      path: "task-guide.yml",
      projection: "task-guide.md",
      revision: `sha256:${"a".repeat(64)}`,
      contentHash: "b".repeat(64),
      sourceRefs: ["018f0000-0000-7000-8000-000000000092"],
      provenance: {},
      approval: { actor: "reviewer", approvedAt: "2026-07-27T00:00:00Z", changeSetHash: "c".repeat(64), revision: `sha256:${"a".repeat(64)}`, contentHash: "b".repeat(64) }
    }
  };
  assert.equal(validate("scope", scopeWithGuide).valid, false, "non-approved Guide metadata must not retain approval binding");
}
