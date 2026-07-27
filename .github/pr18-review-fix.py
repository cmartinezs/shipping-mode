from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"missing expected block in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))

# 1) Every guide transition depends on the canonical guide YAML. Track it in
# baseRevisions even when the transition only changes scope/config metadata.
p = Path("runtime/src/commands/proposalPreparation.mjs")
text = p.read_text()
old = '''    const needsGuideFile = ["generate", "regenerate"].includes(payload.action);\n    return {\n      payload,\n      targetFiles: ["config.yml", `scopes/${payload.scopeId}/scope.yml`, ...(needsGuideFile ? [`scopes/${payload.scopeId}/${payload.guideKind}-guide.yml`] : [])]\n    };'''
new = '''    return {\n      payload,\n      targetFiles: ["config.yml", `scopes/${payload.scopeId}/scope.yml`, `scopes/${payload.scopeId}/${payload.guideKind}-guide.yml`]\n    };'''
if old not in text:
    raise SystemExit("proposalPreparation guide target block not found")
p.write_text(text.replace(old, new, 1))

# 2) ChangeSet invariants: generate requires ABSENT; every later transition
# requires the canonical guide to exist, and all actions track exactly 3 files.
p = Path("runtime/src/lib/changeset.mjs")
text = p.read_text()
old = '''  if (changeSet.kind === "guide.update") {\n    const guidePath = `scopes/${changeSet.payload.scopeId}/${changeSet.payload.guideKind}-guide.yml`;\n    const requiresGuideFile = ["generate", "regenerate"].includes(changeSet.payload.action);\n    const expectedPaths = new Set(["config.yml", `scopes/${changeSet.payload.scopeId}/scope.yml`, ...(requiresGuideFile ? [guidePath] : [])]);\n    const actualPaths = new Set(Object.keys(changeSet.baseRevisions));\n    if (expectedPaths.size !== actualPaths.size || [...expectedPaths].some((target) => !actualPaths.has(target))) {\n      errors.push("guide.update baseRevisions must contain exactly the scope metadata and, for generation, the canonical guide file");\n    }\n    if (changeSet.payload.action === "generate" && [...actualPaths].some((target) => target === guidePath && changeSet.baseRevisions[target].contentHash !== ABSENT)) {\n      errors.push(`${guidePath} must be ABSENT for initial guide.generate`);\n    }\n  }'''
new = '''  if (changeSet.kind === "guide.update") {\n    const guidePath = `scopes/${changeSet.payload.scopeId}/${changeSet.payload.guideKind}-guide.yml`;\n    const expectedPaths = new Set(["config.yml", `scopes/${changeSet.payload.scopeId}/scope.yml`, guidePath]);\n    const actualPaths = new Set(Object.keys(changeSet.baseRevisions));\n    if (expectedPaths.size !== actualPaths.size || [...expectedPaths].some((target) => !actualPaths.has(target))) {\n      errors.push("guide.update baseRevisions must contain exactly config.yml, scope.yml, and the canonical guide YAML");\n    }\n    const guideBase = changeSet.baseRevisions[guidePath];\n    if (changeSet.payload.action === "generate") {\n      if (!guideBase || guideBase.contentHash !== ABSENT) errors.push(`${guidePath} must be ABSENT for initial guide.generate`);\n    } else if (!guideBase || guideBase.contentHash === ABSENT) {\n      errors.push(`${guidePath} must already exist for guide.${changeSet.payload.action}`);\n    }\n  }'''
if old not in text:
    raise SystemExit("changeset guide invariant block not found")
p.write_text(text.replace(old, new, 1))

# 3) Harden Guide aggregate loading, canonical revision/provenance/metadata
# consistency, gap semantics, and render the unchanged guide file on metadata
# transitions so stale detection binds the exact bytes validated.
p = Path("runtime/src/commands/renderers.mjs")
text = p.read_text()
start = text.index('function readScopeForGuide(planningRoot, scopeId) {')
end = text.index('\nfunction sourceIdForAction(', start)
replacement = r'''function readScopeForGuide(planningRoot, scopeId) {
  const scopePath = path.join(planningRoot, "scopes", scopeId, "scope.yml");
  if (!fs.existsSync(scopePath)) throw new Error(`scope not found for guide.update: ${scopeId}`);
  const scope = parseYaml(fs.readFileSync(scopePath, "utf8"));
  const scopeResult = validate("scope", scope);
  if (!scopeResult.valid) throw new Error(`existing scope is invalid: ${scopeResult.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
  if (scope.id !== scopeId) throw new Error(`scope id does not match its directory: ${scopeId}`);
  return scope;
}

function assertClosedGuideInput(document) {
  const allowed = new Set(["sourceRefs", "sections", "openGaps"]);
  for (const key of Object.keys(document || {})) {
    if (!allowed.has(key)) throw new Error(`guide document contains unsupported field: ${key}`);
  }
  if (!Array.isArray(document?.sourceRefs) || document.sourceRefs.length === 0) throw new Error("guide document requires at least one sourceRefs entry");
  if (!Array.isArray(document.sections) || !Array.isArray(document.openGaps)) throw new Error("guide document requires sections and openGaps arrays");
}

function buildGuideDocument({ payload, scopeId, guideKind, guideId, proposedAt, currentSources }) {
  assertClosedGuideInput(payload.document);
  const sourceById = new Map(currentSources.map((source) => [source.id, source]));
  const sourceRefs = [...new Set(payload.document.sourceRefs)];
  const sourceFingerprints = {};
  for (const sourceId of sourceRefs) {
    const source = sourceById.get(sourceId);
    if (!source) throw new Error(`guide sourceRef does not resolve: ${sourceId}`);
    if (!source.confirmedFingerprint) throw new Error(`guide sourceRef has no confirmed fingerprint: ${sourceId}`);
    sourceFingerprints[sourceId] = source.confirmedFingerprint;
  }
  const provenance = {
    sourceMapRevision: revisionHash({ sourceRefs, sourceFingerprints }),
    generatorVersion: "shipping-mode:guide-domain/1",
    model: null,
    promptVersion: null,
    generatedAt: proposedAt,
    sourceFingerprints
  };
  const withoutRevision = {
    schemaVersion: 1,
    dslVersion: 1,
    id: guideId,
    scopeId,
    kind: guideKind,
    sourceRefs,
    provenance,
    sections: payload.document.sections,
    openGaps: payload.document.openGaps
  };
  const document = { ...withoutRevision, revision: `sha256:${revisionHash(withoutRevision)}` };
  const schemaResult = validate("guide", document);
  if (!schemaResult.valid) throw new Error(schemaResult.errors.map((error) => `guide${error.path}: ${error.message}`).join("; "));
  return document;
}

function guideMetadata(document, status, scopeId, content, approval = null) {
  return {
    id: document.id,
    scopeId,
    kind: document.kind,
    status,
    path: guideFileName(document.kind),
    projection: guideProjectionName(document.kind),
    revision: document.revision,
    contentHash: contentHash(content),
    sourceRefs: document.sourceRefs,
    provenance: document.provenance,
    approval
  };
}

function sameCanonicalValue(left, right) {
  return revisionHash(left) === revisionHash(right);
}

function assertGuideAggregateIntegrity({ document, metadata, scopeId, guideKind, guideContent, currentSources }) {
  const result = validate("guide", document);
  if (!result.valid) throw new Error(`existing guide is invalid: ${result.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
  if (document.id !== metadata.id || document.scopeId !== scopeId || document.kind !== guideKind) {
    throw new Error("guide metadata does not match canonical guide document");
  }
  const { revision, ...withoutRevision } = document;
  const expectedRevision = `sha256:${revisionHash(withoutRevision)}`;
  if (revision !== expectedRevision) throw new Error("guide revision does not match canonical guide content");
  const fingerprintKeys = Object.keys(document.provenance?.sourceFingerprints || {}).sort();
  const sourceRefKeys = [...document.sourceRefs].sort();
  if (!sameCanonicalValue(fingerprintKeys, sourceRefKeys)) throw new Error("guide provenance sourceFingerprints keys do not match sourceRefs");
  const expectedSourceMapRevision = revisionHash({ sourceRefs: document.sourceRefs, sourceFingerprints: document.provenance.sourceFingerprints });
  if (document.provenance.sourceMapRevision !== expectedSourceMapRevision) throw new Error("guide provenance sourceMapRevision does not match its source fingerprint map");
  const knownSourceIds = new Set(currentSources.map((source) => source.id));
  for (const sourceId of document.sourceRefs) {
    if (!knownSourceIds.has(sourceId)) throw new Error(`guide sourceRef does not resolve: ${sourceId}`);
  }
  const actualContentHash = contentHash(guideContent);
  if (metadata.revision !== document.revision || metadata.contentHash !== actualContentHash || !sameCanonicalValue(metadata.sourceRefs, document.sourceRefs) || !sameCanonicalValue(metadata.provenance, document.provenance)) {
    throw new Error("guide metadata revision/content/provenance does not match canonical guide document");
  }
  if (metadata.status === "approved") {
    if (!metadata.approval || metadata.approval.revision !== document.revision || metadata.approval.contentHash !== actualContentHash) {
      throw new Error("approved guide metadata is not bound to the canonical guide revision/content hash");
    }
  } else if (metadata.approval !== null) {
    throw new Error("non-approved guide metadata must not retain approval binding");
  }
}

function readExistingGuide({ planningRoot, scopeId, guideKind, metadata, currentSources }) {
  const relativePath = `scopes/${scopeId}/${guideFileName(guideKind)}`;
  const absolutePath = path.join(planningRoot, relativePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`guide does not exist for ${guideKind}/${scopeId}`);
  const guideContent = fs.readFileSync(absolutePath, "utf8");
  const document = parseYaml(guideContent);
  assertGuideAggregateIntegrity({ document, metadata, scopeId, guideKind, guideContent, currentSources });
  return { document, guideContent };
}

function updateGuideGap(config, scopeId, guides) {
  const bothApproved = ["task", "test"].every((kind) => guides[kind]?.status === "approved");
  const documentation = config.documentation || { source_refs: [], gaps: [] };
  const gaps = documentation.gaps || [];
  const isMissingGuideGap = (gap) => gap.concern === "guides" && gap.status === "missing" && gap.scope_ref === scopeId;
  return {
    ...config,
    documentation: {
      ...documentation,
      gaps: bothApproved
        ? gaps.filter((gap) => !isMissingGuideGap(gap))
        : gaps.some(isMissingGuideGap)
          ? gaps
          : [...gaps, { id: generateUuidV7(), concern: "guides", status: "missing", description: `scope ${scopeId} has no approved task and test guides`, scope_ref: scopeId }]
    }
  };
}

export function renderGuideUpdate(payload, currentConfig, planningRoot, { currentSources = [], proposedAt, approval = null } = {}) {
  if (!GUIDE_KINDS.has(payload.guideKind) || !GUIDE_ACTIONS.has(payload.action)) throw new Error("guide.update has an unsupported kind or action");
  const scope = readScopeForGuide(planningRoot, payload.scopeId);
  const currentMetadata = scope.guides?.[payload.guideKind] || null;
  const guideRelativePath = `scopes/${payload.scopeId}/${guideFileName(payload.guideKind)}`;

  // A Guide aggregate transition may depend on the other Guide when deciding
  // whether the Corte 0 missing-guide gap can be resolved. Validate every
  // existing canonical Guide before deriving the new aggregate state.
  const existingGuides = {};
  for (const kind of ["task", "test"]) {
    const metadata = scope.guides?.[kind];
    if (!metadata) continue;
    existingGuides[kind] = readExistingGuide({ planningRoot, scopeId: payload.scopeId, guideKind: kind, metadata, currentSources });
  }

  let document = null;
  let guideContent = null;
  if (["generate", "regenerate"].includes(payload.action)) {
    const guideId = payload.action === "regenerate" ? currentMetadata?.id : payload.guideId;
    if (!guideId) throw new Error("guide generation requires a server-owned guide id");
    document = buildGuideDocument({ payload, scopeId: payload.scopeId, guideKind: payload.guideKind, guideId, proposedAt, currentSources });
    guideContent = stringifyYaml(document);
  } else {
    if (!currentMetadata || !existingGuides[payload.guideKind]) throw new Error(`guide does not exist for ${payload.guideKind}/${payload.scopeId}`);
    ({ document, guideContent } = existingGuides[payload.guideKind]);
  }

  const currentStatus = currentMetadata?.status || null;
  const allowedTransitions = {
    generate: [null],
    regenerate: ["stale", "rejected"],
    submit_review: ["generated"],
    approve: ["reviewed"],
    reject: ["generated", "reviewed"],
    mark_stale: ["approved"]
  };
  if (!allowedTransitions[payload.action].includes(currentStatus)) throw new Error(`invalid guide transition ${currentStatus || "absent"} -> ${payload.action}`);
  const nextStatus = payload.action === "approve" ? (approval ? "approved" : "reviewed")
    : payload.action === "generate" || payload.action === "regenerate" ? "generated"
      : payload.action === "submit_review" ? "reviewed"
        : payload.action === "reject" ? "rejected" : "stale";
  const nextApproval = nextStatus === "approved" ? {
    actor: approval.actor,
    approvedAt: approval.approvedAt,
    changeSetHash: approval.changeSetHash,
    revision: document.revision,
    contentHash: contentHash(guideContent)
  } : null;
  const nextScope = {
    ...scope,
    guides: {
      ...(scope.guides || {}),
      [payload.guideKind]: guideMetadata(document, nextStatus, payload.scopeId, guideContent, nextApproval)
    }
  };
  const nextConfig = updateGuideGap(currentConfig, payload.scopeId, nextScope.guides);
  const rendered = new Map([
    [`scopes/${payload.scopeId}/scope.yml`, stringifyYaml(nextScope)],
    ["config.yml", stringifyYaml(nextConfig)],
    [guideRelativePath, guideContent]
  ]);
  return rendered;
}
'''
text = text[:start] + replacement + text[end:]
p.write_text(text)

# 4) Scope metadata must have an explicit approval slot, bound only when approved.
p = Path("runtime/src/schemas/scope.schema.json")
text = p.read_text()
text = text.replace('"required": ["id", "scopeId", "kind", "status", "path", "projection", "revision", "contentHash", "sourceRefs", "provenance"]', '"required": ["id", "scopeId", "kind", "status", "path", "projection", "revision", "contentHash", "sourceRefs", "provenance", "approval"]', 1)
old = '''        {\n          "if": { "properties": { "status": { "const": "approved" } } },\n          "then": { "required": ["approval"], "properties": { "approval": { "type": "object" } } }\n        }'''
new = '''        {\n          "if": { "properties": { "status": { "const": "approved" } } },\n          "then": { "properties": { "approval": { "type": "object" } } },\n          "else": { "properties": { "approval": { "type": "null" } } }\n        }'''
if old not in text:
    raise SystemExit("scope approval conditional not found")
p.write_text(text.replace(old, new, 1))

# 5) check schema must prove internal provenance and approval binding, not just
# formats. Replace the Guide checker as one coherent function.
p = Path("runtime/src/commands/check.mjs")
text = p.read_text()
start = text.index('function checkGuideConsistency(')
end = text.index('\nexport function checkSchema', start)
replacement = r'''function checkGuideConsistency(planningRoot, scope, scopeId, knownSourceIds, findings) {
  for (const kind of ["task", "test"]) {
    const metadata = scope.guides?.[kind];
    if (!metadata) continue;
    const relativePath = path.join("scopes", scopeId, `${kind}-guide.yml`);
    const guide = checkRequiredFile(planningRoot, relativePath, "guide", findings);
    if (!guide) continue;
    if (guide.id !== metadata.id || guide.scopeId !== scopeId || guide.kind !== kind) {
      findings.push(`${relativePath}: guide metadata identity does not match scope.yml`);
    }
    const { revision, ...withoutRevision } = guide;
    if (guide.revision !== `sha256:${revisionHash(withoutRevision)}`) findings.push(`${relativePath}: revision does not match canonical guide content`);
    const bytes = fs.readFileSync(path.join(planningRoot, relativePath));
    const actualContentHash = contentHash(bytes);
    if (metadata.contentHash !== actualContentHash) findings.push(`${relativePath}: contentHash does not match scope.yml`);
    if (metadata.revision !== guide.revision || revisionHash(metadata.sourceRefs) !== revisionHash(guide.sourceRefs) || revisionHash(metadata.provenance) !== revisionHash(guide.provenance)) {
      findings.push(`${relativePath}: guide revision/source/provenance metadata is inconsistent`);
    }
    const fingerprintKeys = Object.keys(guide.provenance?.sourceFingerprints || {}).sort();
    const sourceRefKeys = [...(guide.sourceRefs || [])].sort();
    if (revisionHash(fingerprintKeys) !== revisionHash(sourceRefKeys)) findings.push(`${relativePath}: provenance sourceFingerprints keys do not match sourceRefs`);
    const expectedSourceMapRevision = revisionHash({ sourceRefs: guide.sourceRefs, sourceFingerprints: guide.provenance?.sourceFingerprints || {} });
    if (guide.provenance?.sourceMapRevision !== expectedSourceMapRevision) findings.push(`${relativePath}: provenance sourceMapRevision is inconsistent`);
    if (metadata.status === "approved") {
      if (!metadata.approval || metadata.approval.revision !== guide.revision || metadata.approval.contentHash !== actualContentHash) {
        findings.push(`${relativePath}: approved metadata is not bound to the canonical guide revision/content hash`);
      }
    } else if (metadata.approval !== null) {
      findings.push(`${relativePath}: non-approved guide retains approval metadata`);
    }
    for (const sourceId of guide.sourceRefs || []) {
      if (!knownSourceIds.includes(sourceId)) findings.push(`${relativePath}: sourceRef ${sourceId} does not resolve`);
    }
  }
}
'''
text = text[:start] + replacement + text[end:]
p.write_text(text)

# 6) Extend lifecycle tests with a real validate->approve->tamper->apply stale
# regression and with missing-gap restoration.
p = Path("runtime/src/commands/tests/guide-lifecycle.test.mjs")
text = p.read_text()
text = text.replace('import { readOperation } from "../../lib/operationStore.mjs";', 'import { readOperation } from "../../lib/operationStore.mjs";\nimport { StaleError } from "../../lib/errors.mjs";', 1)
marker = '''const generated = proposeGuide("generate", { document });\nconst generatedOperation = readOperation(operationsRoot, generated.operationId);\nassert.equal(generatedOperation.kind, "guide.update");\nfinish(generated.operationId);\n\nlet scopeDocument'''
insert = '''const generated = proposeGuide("generate", { document });\nconst generatedOperation = readOperation(operationsRoot, generated.operationId);\nassert.equal(generatedOperation.kind, "guide.update");\nfinish(generated.operationId);\n\n// Every transition over an existing Guide must bind the exact canonical YAML\n// bytes observed at propose/validate. A post-approval edit must stale the\n// operation instead of approving or reviewing unvalidated content.\nconst staleByGuideEdit = proposeGuide("submit_review");\nassert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: staleByGuideEdit.operationId }).status, "VALIDATED");\nrunChangesetApprove({ planningRoot, operationsRoot, operationId: staleByGuideEdit.operationId, actor: "reviewer", mode: "human" });\nconst guidePath = path.join(planningRoot, "scopes", scopeId, "task-guide.yml");\nconst originalGuideBytes = fs.readFileSync(guidePath, "utf8");\nfs.writeFileSync(guidePath, `${originalGuideBytes}\\n`);\nassert.throws(() => runChangesetApply({ planningRoot, operationsRoot, operationId: staleByGuideEdit.operationId, actor: "reviewer" }), StaleError);\nassert.equal(readOperation(operationsRoot, staleByGuideEdit.operationId).status, "STALE");\nfs.writeFileSync(guidePath, originalGuideBytes);\n\nlet scopeDocument'''
if marker not in text:
    raise SystemExit("guide lifecycle generation marker not found")
text = text.replace(marker, insert, 1)
# Remove the guide missing gap after scope creation to exercise deterministic
# restoration during generate in a valid Project Context.
marker2 = '''const scopeId = "018f0000-0000-7000-8000-000000000021";\n\nconst document = {'''
insert2 = '''const scopeId = "018f0000-0000-7000-8000-000000000021";\n\nconst configPath = path.join(planningRoot, "config.yml");\nconst configWithoutGuideGap = parseYaml(fs.readFileSync(configPath, "utf8"));\nconfigWithoutGuideGap.documentation.gaps = [];\nfs.writeFileSync(configPath, JSON.stringify(configWithoutGuideGap));\n\nconst document = {'''
if marker2 not in text:
    raise SystemExit("scopeId marker not found")
text = text.replace(marker2, insert2, 1)
p.write_text(text)

# 7) Schema fixture: explicit non-approved approval metadata must fail.
p = Path("runtime/src/lib/tests/schema-fixtures.test.mjs")
text = p.read_text()
append = '''\n// Corte 1 Guide metadata: approval is explicit and only legal for approved state.\n{\n  const scopeWithGuide = structuredClone(cases.scope.valid);\n  scopeWithGuide.guides = {\n    task: {\n      id: "018f0000-0000-7000-8000-000000000091",\n      scopeId: scopeWithGuide.id,\n      kind: "task",\n      status: "generated",\n      path: "task-guide.yml",\n      projection: "task-guide.md",\n      revision: `sha256:${"a".repeat(64)}`,\n      contentHash: "b".repeat(64),\n      sourceRefs: ["018f0000-0000-7000-8000-000000000092"],\n      provenance: {},\n      approval: { actor: "reviewer", approvedAt: "2026-07-27T00:00:00Z", changeSetHash: "c".repeat(64), revision: `sha256:${"a".repeat(64)}`, contentHash: "b".repeat(64) }\n    }\n  };\n  assert.equal(validate("scope", scopeWithGuide).valid, false, "non-approved Guide metadata must not retain approval binding");\n}\n'''
if 'non-approved Guide metadata must not retain approval binding' not in text:
    text = text.rstrip() + "\n" + append
p.write_text(text)

# 8) Record review corrections in Plan 1.
p = Path("docs/superpowers/plans/2026-07-27-corte-1-plan-1-guide-domain-lifecycle.md")
text = p.read_text()
addition = '''\n## Post-review integrity corrections\n\nAdversarial PR review found and closed three Plan 1 integrity gaps before merge:\n\n- Every `guide.update` action now tracks the canonical `task-guide.yml` / `test-guide.yml` in `baseRevisions`, including metadata-only transitions. A Guide edit between validate/approve/apply therefore produces `STALE` rather than binding lifecycle state to unvalidated bytes.\n- Existing Guide aggregates are revalidated before transitions: canonical revision, content hash, source/provenance mapping, metadata parity, and approval revision/content binding must agree before apply. `check schema` verifies the same relationships query-only.\n- The Corte 0 `guides/missing` gap is restored deterministically when absent, and approval removes only that exact `guides` + `missing` gap; unrelated/conflicting Guide gaps are preserved.\n'''
if '## Post-review integrity corrections' not in text:
    text = text.rstrip() + "\n" + addition
p.write_text(text)

# Normalize changed text files.
for name in [
    "runtime/src/commands/proposalPreparation.mjs",
    "runtime/src/lib/changeset.mjs",
    "runtime/src/commands/renderers.mjs",
    "runtime/src/schemas/scope.schema.json",
    "runtime/src/commands/check.mjs",
    "runtime/src/commands/tests/guide-lifecycle.test.mjs",
    "runtime/src/lib/tests/schema-fixtures.test.mjs",
    "docs/superpowers/plans/2026-07-27-corte-1-plan-1-guide-domain-lifecycle.md",
]:
    p = Path(name)
    p.write_text("\n".join(line.rstrip() for line in p.read_text().splitlines()).rstrip() + "\n")
