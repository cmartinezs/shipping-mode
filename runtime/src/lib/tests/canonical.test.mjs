import assert from "node:assert/strict";
import { canonicalize, canonicalJson, revisionHash, contentHash, ABSENT } from "../canonical.mjs";

assert.deepEqual(canonicalize({ b: 1, a: 2 }), { a: 2, b: 1 });
assert.deepEqual(canonicalize([{ b: 1, a: 2 }]), [{ a: 2, b: 1 }]);

assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }), "key order must not affect canonical JSON");

assert.equal(revisionHash({ name: "x", vcs: "git" }), revisionHash({ vcs: "git", name: "x" }));

const bytesA = Buffer.from("name: x\nvcs: git\n");
const bytesB = Buffer.from("vcs: git\nname: x\n");
assert.notEqual(contentHash(bytesA), contentHash(bytesB), "contentHash must differ when bytes differ even if meaning is the same");

assert.equal(ABSENT, "ABSENT");

console.log("canonical: all tests passed");
