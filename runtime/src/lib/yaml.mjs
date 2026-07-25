import { parseDocument, Document } from "yaml";
import { canonicalize } from "./canonical.mjs";

export function parseYaml(text) {
  const doc = parseDocument(text, { uniqueKeys: true, strict: true });
  if (doc.errors.length > 0) {
    throw new Error(doc.errors.map((error) => error.message).join("; "));
  }
  return doc.toJS({ maxAliasCount: 0 });
}

export function stringifyYaml(value) {
  const doc = new Document(canonicalize(value), { sortMapEntries: true });
  return doc.toString();
}
