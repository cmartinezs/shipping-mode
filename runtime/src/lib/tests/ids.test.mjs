import assert from "node:assert/strict";
import { generateUuidV7, isUuidV7 } from "../ids.mjs";

const a = generateUuidV7();
assert.equal(isUuidV7(a), true, "generated id must be a valid UUIDv7");
assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

const b = generateUuidV7();
assert.notEqual(a, b, "two calls must not collide");

const earlier = generateUuidV7(1000);
const later = generateUuidV7(2000);
assert.ok(earlier < later, "ids generated from an earlier timestamp must sort before a later one lexically");

assert.equal(isUuidV7("not-a-uuid"), false);
assert.equal(isUuidV7("00000000-0000-4000-8000-000000000000"), false, "version nibble must be 7, not 4");

console.log("ids: all tests passed");
