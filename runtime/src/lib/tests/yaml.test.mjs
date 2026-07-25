import assert from "node:assert/strict";
import { parseYaml, stringifyYaml } from "../yaml.mjs";

assert.deepEqual(parseYaml("name: demo\nvcs: git\n"), { name: "demo", vcs: "git" });

assert.throws(() => parseYaml("name: demo\nname: duplicate\n"), /duplicate|unique/i, "duplicate keys must be rejected");

const bomb = "a: &a [1,2,3,4,5,6,7,8]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b]\n";
assert.throws(() => parseYaml(bomb), /alias/i, "alias expansion must be rejected outright");

const out1 = stringifyYaml({ b: 1, a: 2 });
const out2 = stringifyYaml({ a: 2, b: 1 });
assert.equal(out1, out2, "stringify must be deterministic regardless of input key order");

console.log("yaml: all tests passed");
