import crypto from "node:crypto";
import { isUuidV7 } from "./ids.mjs";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RELEASE_DISPLAY_ID_LENGTHS = Object.freeze([8, 12, 16, 26, 52]);
export const RELEASE_DISPLAY_ID_PATTERN = /^REL-([0-9A-HJKMNP-TV-Z]{8}|[0-9A-HJKMNP-TV-Z]{12}|[0-9A-HJKMNP-TV-Z]{16}|[0-9A-HJKMNP-TV-Z]{26}|[0-9A-HJKMNP-TV-Z]{52})$/;

function encodeCrockford(buffer) {
  let value = 0;
  let bits = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
      value &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  if (bits > 0) output += CROCKFORD[(value << (5 - bits)) & 31];
  return output;
}

export function releaseDisplayTokenForUuid(uuid) {
  if (!isUuidV7(uuid)) throw new Error(`invalid release UUIDv7: ${uuid}`);
  const uuidBytes = Buffer.from(uuid.replaceAll("-", ""), "hex");
  return encodeCrockford(crypto.createHash("sha256").update(uuidBytes).digest());
}

export function releaseDisplayIdForUuid(uuid, length = 8) {
  if (!RELEASE_DISPLAY_ID_LENGTHS.includes(length)) throw new Error(`unsupported display ID length: ${length}`);
  return `REL-${releaseDisplayTokenForUuid(uuid).slice(0, length)}`;
}

export function deriveUniqueReleaseDisplayId(uuid, existingReleases = []) {
  for (const length of RELEASE_DISPLAY_ID_LENGTHS) {
    const candidate = releaseDisplayIdForUuid(uuid, length);
    const collision = existingReleases.find((release) => release.displayId === candidate && release.id !== uuid);
    if (!collision) return { displayId: candidate, length, collisionResolved: length > RELEASE_DISPLAY_ID_LENGTHS[0] };
  }
  throw new Error(`display ID collision for release ${uuid}`);
}

export function isReleaseDisplayId(value) {
  return typeof value === "string" && RELEASE_DISPLAY_ID_PATTERN.test(value);
}

export function isReleaseDisplayIdForUuid(uuid, displayId) {
  if (!isUuidV7(uuid) || !isReleaseDisplayId(displayId)) return false;
  return RELEASE_DISPLAY_ID_LENGTHS.some((length) => releaseDisplayIdForUuid(uuid, length) === displayId);
}
