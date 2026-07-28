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

export function normalizeGuideGeneratorConfig(generator) {
  if (!generator) return null;
  return {
    executable: generator.executable,
    args: [...(generator.args || [])],
    cwd: generator.cwd || null,
    version: generator.version,
    timeoutMs: generator.timeoutMs || 1000,
    maxOutputBytes: generator.maxOutputBytes || 256 * 1024
  };
}

export function customGuideGenerationInputHash({ input, generator }) {
  return revisionHash({ guideInput: input, generatorConfig: normalizeGuideGeneratorConfig(generator) });
}

export function buildGuideGenerationInput({ scope, guideKind, sources, config }) {
  const refs = [...new Set(config.documentation?.source_refs || [])].sort();
  if (refs.length === 0) throw new Error("guide generation requires approved Project Context documentation.source_refs");
  const byId = new Map(sources.map((source) => [source.id, source]));
  const missing = refs.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`approved Documentation Source refs do not resolve: ${missing.join(", ")}`);
  const selected = refs.map((id) => byId.get(id));
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
  const openGaps = [{
    id: sourceRefs[0],
    category: "generation_incomplete",
    description: "generic metadata-only generation cannot derive executable guide rules; human or custom-generator input is required",
    sourceRefs
  }];
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
    return {
      document: result.output,
      evidence: {
        generationMethod: "custom",
        generatorVersion: generator.version,
        generatorFingerprint: result.generatorFingerprint,
        generationInputHash: customGuideGenerationInputHash({ input: built.input, generator }),
        generationOutputHash: result.outputHash
      }
    };
  }
  const document = genericGuideOutput(built.input);
  return {
    document,
    evidence: {
      generationMethod: "generic",
      generatorVersion: "shipping-mode:generic-guide/1",
      generatorFingerprint: null,
      generationInputHash: built.inputHash,
      generationOutputHash: revisionHash(document)
    }
  };
}
