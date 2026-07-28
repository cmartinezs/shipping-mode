from pathlib import Path

# The lifecycle fixture manually installs a confirmed source; approve that exact
# source in Project Context instead of relying on the removed all-Discovery fallback.
path = Path("runtime/src/commands/tests/guide-lifecycle.test.mjs")
text = path.read_text()
old = '''const configWithoutGuideGap = parseYaml(fs.readFileSync(configPath, "utf8"));
configWithoutGuideGap.documentation.gaps = [];
fs.writeFileSync(configPath, JSON.stringify(configWithoutGuideGap));'''
new = '''const configWithoutGuideGap = parseYaml(fs.readFileSync(configPath, "utf8"));
configWithoutGuideGap.documentation.source_refs = [sourceId];
configWithoutGuideGap.documentation.gaps = [];
fs.writeFileSync(configPath, JSON.stringify(configWithoutGuideGap));'''
if old not in text:
    raise SystemExit("guide lifecycle config fixture block not found")
path.write_text(text.replace(old, new, 1))

# spawnSync can report ENOBUFS together with a termination signal. Output-limit
# classification must win over timeout classification.
path = Path("runtime/src/lib/customGuideGenerator.mjs")
text = path.read_text()
old = '''  if (child.error?.code === "ETIMEDOUT" || child.signal === "SIGTERM" || child.signal === "SIGKILL") throw new Error("generator timeout");
  if (child.error?.code === "ENOBUFS") throw new Error("generator output exceeds limit");'''
new = '''  if (child.error?.code === "ENOBUFS") throw new Error("generator output exceeds limit");
  if (child.error?.code === "ETIMEDOUT" || child.signal === "SIGTERM" || child.signal === "SIGKILL") throw new Error("generator timeout");'''
if old not in text:
    raise SystemExit("generator error classification block not found")
path.write_text(text.replace(old, new, 1))

# Structural schema coverage follows every public ChangeSet kind instead of a
# stale hard-coded branch count.
path = Path("runtime/src/schemas/tests/schemas-are-valid-json.test.mjs")
text = path.read_text()
old = '''const changeSet = JSON.parse(fs.readFileSync(path.join(schemasDir, "change-set.schema.json"), "utf8"));
assert.ok(Array.isArray(changeSet.allOf) && changeSet.allOf.length === 7, "change-set schema must conditionally validate payload shape per kind");'''
new = '''const changeSet = JSON.parse(fs.readFileSync(path.join(schemasDir, "change-set.schema.json"), "utf8"));
const conditionalKinds = new Set(changeSet.allOf.map((entry) => entry.if?.properties?.kind?.const).filter(Boolean));
assert.deepEqual(conditionalKinds, new Set(changeSet.properties.kind.enum), "change-set schema must conditionally validate payload shape for every public kind");'''
if old not in text:
    raise SystemExit("schema structural assertion not found")
path.write_text(text.replace(old, new, 1))
