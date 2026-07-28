import fs from "node:fs";
import path from "node:path";
import { parseYaml } from "./yaml.mjs";
import { isUuidV7 } from "./ids.mjs";
import { isReleaseDisplayId } from "./releaseIdentity.mjs";
import { validate } from "./schema.mjs";
import { confineWritePath } from "./paths.mjs";

export function releaseRelativeDir(releaseId) {
  if (!isUuidV7(releaseId)) throw new Error(`invalid release id: ${releaseId}`);
  return path.join("releases", releaseId);
}

export function releaseYamlRelativePath(releaseId) {
  return path.join(releaseRelativeDir(releaseId), "release.yml");
}

export function releaseReadmeRelativePath(releaseId) {
  return path.join(releaseRelativeDir(releaseId), "README.md");
}

export function readReleaseFile(planningRoot, releaseId) {
  const relativePath = releaseYamlRelativePath(releaseId);
  const filePath = confineWritePath(planningRoot, relativePath);
  const release = parseYaml(fs.readFileSync(filePath, "utf8"));
  return { relativePath, filePath, release };
}

export function listReleaseDocuments(planningRoot, { includeInvalid = false } = {}) {
  const releasesRoot = path.join(planningRoot, "releases");
  if (!fs.existsSync(releasesRoot)) return [];
  const documents = [];
  for (const entry of fs.readdirSync(releasesRoot).sort()) {
    if (!isUuidV7(entry)) continue;
    const releasePath = path.join(releasesRoot, entry, "release.yml");
    if (!fs.existsSync(releasePath)) continue;
    try {
      const release = parseYaml(fs.readFileSync(releasePath, "utf8"));
      const schemaResult = validate("release", release);
      if (includeInvalid || schemaResult.valid) documents.push(release);
    } catch {
      if (includeInvalid) documents.push({ id: entry, invalid: true });
    }
  }
  return documents;
}

export function resolveReleaseReference(planningRoot, reference) {
  if (isUuidV7(reference)) {
    const releasePath = path.join(planningRoot, releaseYamlRelativePath(reference));
    if (!fs.existsSync(releasePath)) return { status: "NOT_FOUND", reference, findings: [`release not found: ${reference}`] };
    const { release } = readReleaseFile(planningRoot, reference);
    return { status: "FOUND", reference, release, findings: [] };
  }
  if (!isReleaseDisplayId(reference)) {
    return { status: "NOT_FOUND", reference, findings: ["release references must be UUIDv7 or display ID; slug is not accepted"] };
  }
  const matches = listReleaseDocuments(planningRoot, { includeInvalid: true })
    .filter((release) => release.displayId === reference);
  if (matches.length === 0) return { status: "NOT_FOUND", reference, findings: [`release not found: ${reference}`] };
  if (matches.length > 1) {
    return {
      status: "AMBIGUOUS",
      reference,
      findings: [`display ID ${reference} is ambiguous across ${matches.length} releases`],
      matches: matches.map((release) => release.id).sort()
    };
  }
  return { status: "FOUND", reference, release: matches[0], findings: [] };
}
