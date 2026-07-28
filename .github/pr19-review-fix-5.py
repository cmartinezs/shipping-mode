from pathlib import Path
import json

path = Path("runtime/src/schemas/guide.schema.json")
schema = json.loads(path.read_text())
for variant in schema["oneOf"]:
    props = variant.setdefault("properties", {})
    for field in variant.get("required", []):
        props.setdefault(field, {})
path.write_text(json.dumps(schema, indent=2) + "\n")
