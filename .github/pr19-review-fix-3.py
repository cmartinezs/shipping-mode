from pathlib import Path
import json

path = Path("runtime/src/schemas/change-set.schema.json")
schema = json.loads(path.read_text())
for branch in schema["allOf"]:
    if branch.get("if", {}).get("properties", {}).get("kind", {}).get("const") == "guide.update":
        payload = branch["then"]["properties"]["payload"]
        generation_branch = payload["allOf"][0]["then"]
        generation_branch.setdefault("properties", {})["generationEvidence"] = payload["properties"]["generationEvidence"]
        break
else:
    raise SystemExit("guide.update schema branch not found")
path.write_text(json.dumps(schema, indent=2) + "\n")
