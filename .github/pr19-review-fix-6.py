from pathlib import Path
import json

path = Path("runtime/src/schemas/guide.schema.json")
schema = json.loads(path.read_text())
for branch in schema["$defs"]["typedValue"]["allOf"]:
    branch["then"]["properties"]["value"]["type"] = "string"
path.write_text(json.dumps(schema, indent=2) + "\n")
