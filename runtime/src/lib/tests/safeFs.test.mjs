import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFileAtomic, renameWithinRoot, writeFileAtomic } from "../safeFs.mjs";
import { PathConfinementError } from "../paths.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "safe-fs-"));
writeFileAtomic(root, "nested/value.txt", "one\n");
writeFileAtomic(root, "nested/value.txt", "two\n");
assert.equal(fs.readFileSync(path.join(root, "nested", "value.txt"), "utf8"), "two\n");
assert.equal(fs.readdirSync(path.join(root, "nested")).some((name) => name.includes(".tmp-")), false);

createFileAtomic(root, "events/one.json", "{}\n");
assert.throws(() => createFileAtomic(root, "events/one.json", "different\n"), (error) => error.code === "EEXIST");
assert.equal(fs.readFileSync(path.join(root, "events", "one.json"), "utf8"), "{}\n");

writeFileAtomic(root, "staged/file.txt", "payload\n");
renameWithinRoot(root, "staged/file.txt", "canonical/file.txt");
assert.equal(fs.readFileSync(path.join(root, "canonical", "file.txt"), "utf8"), "payload\n");

const outside = fs.mkdtempSync(path.join(os.tmpdir(), "safe-fs-outside-"));
fs.symlinkSync(outside, path.join(root, "redirect"));
assert.throws(() => writeFileAtomic(root, "redirect/pwned.txt", "bad"), PathConfinementError);
assert.equal(fs.existsSync(path.join(outside, "pwned.txt")), false);

const outsideTarget = path.join(outside, "target.txt");
fs.writeFileSync(outsideTarget, "original\n");
fs.symlinkSync(outsideTarget, path.join(root, "target-link.txt"));
assert.throws(() => writeFileAtomic(root, "target-link.txt", "bad\n"), PathConfinementError);
assert.equal(fs.readFileSync(outsideTarget, "utf8"), "original\n");

console.log("safeFs: atomic writes are no-clobber where required and reject symlinked mutation paths");
