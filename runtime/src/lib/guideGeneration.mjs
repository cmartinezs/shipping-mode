import { revisionHash } from "./canonical.mjs";
import { runConfiguredGuideGenerator } from "./customGuideGenerator.mjs";

function sourceSnapshot(source) {
  return {
    id: source.id,
    family: source.family,
    kind: source.kind,
    role: source.role,
    authority: source.authority,
    availability: source.availability,
    confirmedFingerprint: source.confirmedFingerprint
  };
}

export function buildGuideGenerationInput({ scope, guideKind, sources, config }) {
  const configuredRefs = config.documentation?.source_refs || [];
  const refs = [...new Set(configuredRefs.length ? configuredRefs : sources.map((source) => source.id))].sort();
  const byId = new Map(sources.map((source) => [source.id, source]));
  const selected = refs.map((id) => byId.get(id)).filter(Boolean).sort((left, right) => left.id.localeCompare(right.id));
  const input = {
    schemaVersion: 1,
    dslVersion: 1,
    guideKind,
    scope: { id: scope.id, key: scope.key, label: scope.label, kind: scope.kind, path: scope.path },
    sourceRefs: selected.map((source) => source.id),
    sources: selected.map(sourceSnapshot),
    commands: scope.commands || {},
    configRefs: { scopeCatalog: config.scopeCatalog || null, documentationSourceRefs: refs },
    schemaVersionRef: "guide/1",
    dslVersionRef: "guide-dsl/1"
  };
  return { input, inputHash: revisionHash(input) };
}

export function genericGuideOutput(input) {
  const sourceRefs = [...input.sourceRefs].sort();
  const authoritative = input.sources.filter((source) => source.role === "canonical" || source.authority?.standing === "authoritative");
  const groups = new Map();
  for (const source of authoritative) {
    const key = `${source.family}:${source.kind}`;
    const group = groups.get(key) || [];
    group.push(source);
    groups.set(key, group);
  }
  const conflicts = [...groups.values()].filter((group) => new Set(group.map((source) => source.confirmedFingerprint)).size > 1);
  const openGaps = conflicts.map((group) => ({ id: group[0].id, category: "source_conflict", description: `conflicting authoritative Documentation Sources for ${group[0].family}/${group[0].kind}`, sourceRefs: group.map((source) => source.id).sort() }));
  if (!sourceRefs.length) openGaps.push({ id: "018f0000-0000-7000-8000-000000000000", description: "no approved Documentation Sources are configured" });
  if (input.guideKind === "task") {
    return { sourceRefs, workPackageTypes: [], taskTypes: [], requiredSections: [], requiredGateRefs: [], templateRefs: [], decompositionRules: [], automation: { fallback: "markGaps" }, openGaps };
  }
  return { sourceRefs, gatesByWorkPackageType: [], gatesByTaskType: [], commandRefs: [], evidenceRequirements: [], testData: [], executionContexts: [], environments: [], openGaps };
}

export function generateGuideOutput({ workspaceRoot, scope, guideKind, sources, config }) {
  const built = buildGuideGenerationInput({ scope, guideKind, sources, config });
  const generator = scope.customGenerators?.[guideKind];
  if (generator) {
    const result = runConfiguredGuideGenerator({ workspaceRoot, generator, input: built.input, timeoutMs: generator.timeoutMs || 1000, maxOutputBytes: generator.maxOutputBytes || 256 * 1024 });
    return { document: result.output, inputHash: result.inputHash, outputHash: result.outputHash, generatorFingerprint: result.generatorFingerprint };
  }
  return { document: genericGuideOutput(built.input), inputHash: built.inputHash, outputHash: revisionHash(genericGuideOutput(built.input)), generatorFingerprint: null };
}
