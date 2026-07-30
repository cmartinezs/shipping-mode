import crypto from "node:crypto";
import { isUuidV7 } from "./ids.mjs";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RELEASE_ITEM_DISPLAY_ID_LENGTHS = Object.freeze([8, 12, 16, 26, 52]);
export const RELEASE_ITEM_DISPLAY_ID_PATTERN = /^RI-([0-9A-HJKMNP-TV-Z]{8}|[0-9A-HJKMNP-TV-Z]{12}|[0-9A-HJKMNP-TV-Z]{16}|[0-9A-HJKMNP-TV-Z]{26}|[0-9A-HJKMNP-TV-Z]{52})$/;

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

export function releaseItemDisplayTokenForUuid(uuid) {
  if (!isUuidV7(uuid)) throw new Error(`invalid Release Item UUIDv7: ${uuid}`);
  const uuidBytes = Buffer.from(uuid.replaceAll("-", ""), "hex");
  return encodeCrockford(crypto.createHash("sha256").update(uuidBytes).digest());
}

export function releaseItemDisplayIdForUuid(uuid, length = 8) {
  if (!RELEASE_ITEM_DISPLAY_ID_LENGTHS.includes(length)) throw new Error(`unsupported Release Item display ID length: ${length}`);
  return `RI-${releaseItemDisplayTokenForUuid(uuid).slice(0, length)}`;
}

export function deriveUniqueReleaseItemDisplayId(uuid, existingItems = []) {
  for (const length of RELEASE_ITEM_DISPLAY_ID_LENGTHS) {
    const candidate = releaseItemDisplayIdForUuid(uuid, length);
    const collision = existingItems.find((item) => item.displayId === candidate && item.id !== uuid);
    if (!collision) return { displayId: candidate, length, collisionResolved: length > RELEASE_ITEM_DISPLAY_ID_LENGTHS[0] };
  }
  throw new Error(`display ID collision for Release Item ${uuid}`);
}

export function isReleaseItemDisplayId(value) {
  return typeof value === "string" && RELEASE_ITEM_DISPLAY_ID_PATTERN.test(value);
}

export function isReleaseItemDisplayIdForUuid(uuid, displayId) {
  if (!isUuidV7(uuid) || !isReleaseItemDisplayId(displayId)) return false;
  return RELEASE_ITEM_DISPLAY_ID_LENGTHS.some((length) => releaseItemDisplayIdForUuid(uuid, length) === displayId);
}
