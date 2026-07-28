from pathlib import Path
import json

path = Path("runtime/src/schemas/guide.schema.json")
schema = json.loads(path.read_text())
datetime_value = schema["$defs"]["typedValue"]["allOf"][1]["then"]["properties"]["value"]
datetime_value.pop("format", None)
datetime_value["pattern"] = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
path.write_text(json.dumps(schema, indent=2) + "\n")
