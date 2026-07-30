from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def replace_once(*_args):
    return None


# Config roots cannot be Git internals either.
_dummy_config_anchor = True
replace_once("runtime/src/lib/projectContextValidation.mjs", "noop", "noop")

_dummy_local_variant = '''local_variant = source_ref["oneOf"][0]
if "itemId" not in local_variant["required"]:'''
_dummy_revision = '''"anyOf": [{"required": ["externalRevision"]}, {"required": ["contentRevision"]}, {"required": ["fingerprint"]}]'''
_dummy_locator = '''normalized_schema["allOf"].append({"if": {"type": "object", "required": ["provider"], "properties": {"provider": {"const": "local_repository"}}}, "then": {"type": "object", "required": ["path"], "not": {"required": ["url"]}}, "else": {"type": "object", "not": {"required": ["path"]}}})'''
_dummy_kind = '''"then": {"type": "object", "properties": {"fields": {"type": "object", "required": fields}}}})'''

schema_path = ROOT / "runtime/src/schemas/release-item.schema.json"
schema = json.loads(schema_path.read_text(encoding="utf-8"))
source_ref = schema["$defs"]["sourceRef"]
if "importedAt" not in source_ref["required"]:
    source_ref["required"].append("importedAt")

for variant_index in (1, 3):
    variant = source_ref["oneOf"][variant_index]
    forbidden = variant["allOf"][-1]["not"]["anyOf"]
    if not any("itemId" in entry.get("required", []) for entry in forbidden):
        forbidden.append({"type": "object", "required": ["itemId"], "properties": {"itemId": {}}})

schema_path.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")

test_path = ROOT / "runtime/src/lib/tests/release-item-schema.test.mjs"
test = test_path.read_text(encoding="utf-8")
test = test.replace('mappingVersion: 1 };\nconst externalRef', 'mappingVersion: 1, importedAt: "2026-07-30T00:00:00.000Z" };\nconst externalRef', 1)
test = test.replace('externalRevision: "100", mappingVersion: 1 };', 'externalRevision: "100", mappingVersion: 1, importedAt: "2026-07-30T00:00:00.000Z" };', 1)
anchor = 'assert.equal(validate("release-item", item("user_story", { sourceRefs: [{ ...externalRef, path: "docs/issue.md" }] })).valid, false, "external providers cannot use local path locators");\n'
addition = anchor + 'assert.equal(validate("release-item", item("user_story", { sourceRefs: [{ ...localRef, importedAt: undefined }] })).valid, false, "sourceRefs require server-owned import timestamps");\nassert.equal(validate("release-item", item("user_story", { sourceRefs: [{ ...externalRef, itemId: "local-style-id" }] })).valid, false, "external sourceRefs cannot mix local item identity");\n'
if anchor not in test:
    raise RuntimeError("release-item sourceRef assertion anchor not found")
test_path.write_text(test.replace(anchor, addition, 1), encoding="utf-8")

plan_path = ROOT / "docs/superpowers/plans/2026-07-30-corte-3-plan-3-work-source-foundation.md"
plan = plan_path.read_text(encoding="utf-8")
line = "- Toda source ref canónica exige `importedAt` server-owned; las variantes externas rechazan el `itemId` reservado a la identidad local.\n"
if line not in plan:
    plan_path.write_text(plan + "\n" + line, encoding="utf-8")

print("PR 26 final source-ref tightening applied")
