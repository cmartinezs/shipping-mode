#!/usr/bin/env node

export function isSupportedNode(version = process.versions.node) {
  return Number(String(version).split(".")[0]) >= 20;
}

export function preflight(version = process.versions.node) {
  return {
    node: version,
    supported: isSupportedNode(version),
    runtime: "self-contained-bundle"
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = preflight();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.supported) process.exitCode = 1;
}
