import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dispatch, UsageError } from "../../index.mjs";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "public-generator-kind-"));
assert.throws(
  () => dispatch("changeset", ["propose", "--kind", "scope.generator.set"], cwd),
  (error) => error instanceof UsageError && /requires --actor/.test(error.message),
  "scope.generator.set must be a real public ChangeSet kind, not NOT_IMPLEMENTED"
);
console.log("public scope.generator.set: dispatch recognizes the ChangeSet kind");
