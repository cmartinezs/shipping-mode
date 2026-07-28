import { isUuidV7 } from "./ids.mjs";

export const RELEASE_DISPLAY_ID_PATTERN = /^REL-([0-9A-F]{8}|[0-9A-F]{12}|[0-9A-F]{16}|[0-9A-F]{32})$/;

function uuidToken(uuid) {
  return uuid.replaceAll("-", "").toUpperCase();
}

export function releaseDisplayIdForUuid(uuid, length = 8) {
  if (!isUuidV7(uuid)) throw new Error(`invalid release UUIDv7: ${uuid}`);
  if (![8, 12, 16, 32].includes(length)) throw new Error(`unsupported display ID length: ${length}`);
  return `REL-${uuidToken(uuid).slice(0, length)}`;
}

export function deriveUniqueReleaseDisplayId(uuid, existingReleases = []) {
  for (const length of [8, 12, 16, 32]) {
    const candidate = releaseDisplayIdForUuid(uuid, length);
    const collision = existingReleases.find((release) => release.displayId === candidate && release.id !== uuid);
    if (!collision) return { displayId: candidate, length, collisionResolved: length > 8 };
  }
  throw new Error(`display ID collision for release ${uuid}`);
}

export function isReleaseDisplayId(value) {
  return typeof value === "string" && RELEASE_DISPLAY_ID_PATTERN.test(value);
}
