import assert from "node:assert/strict";
import { prepareProposal } from "../proposalPreparation.mjs";
import { isUuidV7 } from "../../lib/ids.mjs";
import { UsageError } from "../../lib/errors.mjs";
import { BOOTSTRAP_CANONICAL_DIRECTORIES } from "../../lib/bootstrapTopology.mjs";

const init = prepareProposal("workspace.init", { name: "demo", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` });
assert.deepEqual(init.targetFiles, ["config.yml", "plugin.lock.yml", ".gitignore", ...BOOTSTRAP_CANONICAL_DIRECTORIES]);

const configUpdate = prepareProposal("config.update", { name: "renamed" });
assert.deepEqual(configUpdate.targetFiles, ["config.yml"]);

const scopeWithoutId = prepareProposal("scope.add", { key: "backend", label: "Backend", kind: "code", path: "api/" });
assert.ok(isUuidV7(scopeWithoutId.payload.id));
assert.deepEqual(scopeWithoutId.targetFiles, ["config.yml", `scopes/${scopeWithoutId.payload.id}/scope.yml`]);

const fixedId = "018f0000-0000-7000-8000-000000000000";
const scopeWithId = prepareProposal("scope.add", { id: fixedId, key: "backend", label: "Backend", kind: "code", path: "api/" });
assert.equal(scopeWithId.payload.id, fixedId);
assert.deepEqual(scopeWithId.targetFiles, ["config.yml", `scopes/${fixedId}/scope.yml`]);

const commandSet = prepareProposal(
  "scope.command.set",
  { scopeId: fixedId, role: "test", command: "npm test", requiresEnvironment: false, requiresSecrets: false, declaredBy: "caller" },
  { operationId: "018f0000-0000-7000-8000-000000000099", actor: "runtime", proposedAt: "2026-07-26T00:00:00.000Z" }
);
assert.deepEqual(commandSet.targetFiles, [`scopes/${fixedId}/scope.yml`]);
assert.equal(commandSet.payload.declaredBy, "runtime", "declared provenance comes from runtime actor, never caller payload");
assert.equal(commandSet.payload.declaredAt, "2026-07-26T00:00:00.000Z");
assert.equal(commandSet.payload.operationId, "018f0000-0000-7000-8000-000000000099");
const commandRuntimeContext = { operationId: "018f0000-0000-7000-8000-000000000099", actor: "runtime", proposedAt: "2026-07-26T00:00:00.000Z" };
assert.throws(() => prepareProposal("scope.command.set", { scopeId: fixedId, role: "test", command: "npm test" }, commandRuntimeContext), UsageError, "required booleans must not default implicitly");
assert.throws(() => prepareProposal("scope.command.set", { scopeId: fixedId, role: "test", command: "npm test", requiresEnvironment: "false", requiresSecrets: false }, commandRuntimeContext), UsageError, "string booleans must not be truthiness-coerced");
assert.throws(() => prepareProposal("scope.command.set", { scopeId: fixedId, role: "test", command: "npm test" }), UsageError);

assert.throws(() => prepareProposal("release.create", {}), UsageError);
for (const invalidPayload of [null, [], "text", 42]) {
  assert.throws(() => prepareProposal("scope.add", invalidPayload), UsageError, "non-object payloads are expected usage errors, never TypeError crashes");
}

console.log("proposalPreparation: target derivation and payload type rejection pass");
