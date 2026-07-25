import assert from "node:assert/strict";
import { prepareProposal } from "../proposalPreparation.mjs";
import { isUuidV7 } from "../../lib/ids.mjs";
import { UsageError } from "../../lib/errors.mjs";

const init = prepareProposal("workspace.init", { name: "demo", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` });
assert.deepEqual(init.targetFiles, ["config.yml", "plugin.lock.yml", ".gitignore"]);

const configUpdate = prepareProposal("config.update", { name: "renamed" });
assert.deepEqual(configUpdate.targetFiles, ["config.yml"]);

const scopeWithoutId = prepareProposal("scope.add", { key: "backend", label: "Backend", kind: "code", path: "api/" });
assert.ok(isUuidV7(scopeWithoutId.payload.id), "a scope id must be generated when the raw payload doesn't already have one");
assert.deepEqual(scopeWithoutId.targetFiles, ["config.yml", `scopes/${scopeWithoutId.payload.id}/scope.yml`], "scope.add's targetFiles must include the new scope's own path, built from its id");

const fixedId = "018f0000-0000-7000-8000-000000000000";
const scopeWithId = prepareProposal("scope.add", { id: fixedId, key: "backend", label: "Backend", kind: "code", path: "api/" });
assert.equal(scopeWithId.payload.id, fixedId, "an already-fixed id must never be regenerated");
assert.deepEqual(scopeWithId.targetFiles, ["config.yml", `scopes/${fixedId}/scope.yml`]);

assert.throws(() => prepareProposal("release.create", {}), UsageError);

console.log("proposalPreparation: all tests passed");
