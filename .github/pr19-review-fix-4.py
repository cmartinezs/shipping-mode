from pathlib import Path
import json

path = Path("runtime/src/schemas/guide.schema.json")
schema = json.loads(path.read_text())
for variant in schema["oneOf"]:
    for entry in variant["not"]["anyOf"]:
        field = entry["required"][0]
        entry["properties"] = {field: {}}
path.write_text(json.dumps(schema, indent=2) + "\n")
