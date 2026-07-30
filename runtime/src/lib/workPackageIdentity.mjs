import crypto from "node:crypto";
import { isUuidV7 } from "./ids.mjs";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const WORK_PACKAGE_DISPLAY_ID_LENGTHS = Object.freeze([8, 12, 16, 26, 52]);
export const WORK_PACKAGE_DISPLAY_ID_PATTERN = /^WP-([0-9A-HJKMNP-TV-Z]{8}|[0-9A-HJKMNP-TV-Z]{12}|[0-9A-HJKMNP-TV-Z]{16}|[0-9A-HJKMNP-TV-Z]{26}|[0-9A-HJKMNP-TV-Z]{52})$/;

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

export function workPackageDisplayTokenForUuid(uuid) {
  if (!isUuidV7(uuid)) throw new Error(`invalid Work Package UUIDv7: ${uuid}`);
  const uuidBytes = Buffer.from(uuid.replaceAll("-", ""), "hex");
  return encodeCrockford(crypto.createHash("sha256").update(uuidBytes).digest());
}

export function workPackageDisplayIdForUuid(uuid, length = 8) {
  if (!WORK_PACKAGE_DISPLAY_ID_LENGTHS.includes(length)) throw new Error(`unsupported Work Package display ID length: ${length}`);
  return `WP-${workPackageDisplayTokenForUuid(uuid).slice(0, length)}`;
}

export function deriveUniqueWorkPackageDisplayId(uuid, existingPackages = []) {
  for (const length of WORK_PACKAGE_DISPLAY_ID_LENGTHS) {
    const candidate = workPackageDisplayIdForUuid(uuid, length);
    const collision = existingPackages.find((pkg) => pkg.displayId === candidate && pkg.id !== uuid);
    if (!collision) return { displayId: candidate, length, collisionResolved: length > WORK_PACKAGE_DISPLAY_ID_LENGTHS[0] };
  }
  throw new Error(`display ID collision for Work Package ${uuid}`);
}

export function isWorkPackageDisplayId(value) {
  return typeof value === "string" && WORK_PACKAGE_DISPLAY_ID_PATTERN.test(value);
}

export function isWorkPackageDisplayIdForUuid(uuid, displayId) {
  if (!isUuidV7(uuid) || !isWorkPackageDisplayId(displayId)) return false;
  return WORK_PACKAGE_DISPLAY_ID_LENGTHS.some((length) => workPackageDisplayIdForUuid(uuid, length) === displayId);
}
