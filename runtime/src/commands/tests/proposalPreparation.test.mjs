import assert from "node:assert/strict";
import { prepareProposal } from "../proposalPreparation.mjs";
import { isUuidV7 } from "../../lib/ids.mjs";
import { UsageError } from "../../lib/errors.mjs";

const init = prepareProposal("workspace.init", { name: "demo", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` });
assert.deepEqual(init.targetFiles, ["config.yml", "plugin.lock.yml", ".gitignore"]);

const configUpdate = prepareProposal("config.update", { name: "renamed" });
assert.deepEqual(configUpdate.targetFiles, ["config.yml"]);

const scopeWithoutId = prepareProposal("scope.add", { key: "backend", label: "Backend", kind: "code", path: "api/" });
assert.ok(isUuidV7(scopeWithoutId.payload.id));
assert.deepEqual(scopeWithoutId.targetFiles, ["config.yml", `scopes/${scopeWithoutId.payload.id}/scope.yml`]);

const fixedId = "018f0000-0000-7000-8000-000000000000";
const scopeWithId = prepareProposal("scope.add", { id: fixedId, key: "backend", label: "Backend", kind: "code", path: "api/" });
assert.equal(scopeWithId.payload.id, fixedId);
assert.deepEqual(scopeWithId.targetFiles, ["config.yml", `scopes/${fixedId}/scope.yml`]);

assert.throws(() => prepareProposal("release.create", {}), UsageError);
for (const invalidPayload of [null, [], "text", 42]) {
  assert.throws(() => prepareProposal("scope.add", invalidPayload), UsageError, "non-object payloads are expected usage errors, never TypeError crashes");
}

console.log("proposalPreparation: target derivation and payload type rejection pass");
