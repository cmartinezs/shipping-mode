import path from "node:path";
import { propose } from "../lib/changeset.mjs";
import { prepareProposal } from "./proposalPreparation.mjs";
import { PLUGIN_VERSION, TEMPLATE_PACK_FINGERPRINT } from "../generated/build-meta.mjs";

export function runInit({ planningRoot, args }) {
  const operationsRoot = path.join(planningRoot, "operations");
  const { payload, targetFiles } = prepareProposal("workspace.init", {
    name: args.name,
    projectType: args.projectType || "unknown",
    baseBranch: args.baseBranch || null,
    vcs: args.vcs || "none",
    pluginVersion: PLUGIN_VERSION,
    templatePackFingerprint: TEMPLATE_PACK_FINGERPRINT
  });
  const operationId = propose({ operationsRoot, planningRoot, kind: "workspace.init", target: {}, payload, targetFiles, actor: args.actor });
  return { operationId };
}

export function runConfigSet({ planningRoot, args }) {
  const operationsRoot = path.join(planningRoot, "operations");
  const { payload, targetFiles } = prepareProposal("config.update", { name: args.name });
  const operationId = propose({ operationsRoot, planningRoot, kind: "config.update", target: {}, payload, targetFiles, actor: args.actor });
  return { operationId };
}

export function runConfigScopeAdd({ planningRoot, args }) {
  const operationsRoot = path.join(planningRoot, "operations");
  const { payload, targetFiles } = prepareProposal("scope.add", {
    key: args.key, label: args.label, kind: args.kind, path: args.path, owner: args.owner || null
  });
  const operationId = propose({ operationsRoot, planningRoot, kind: "scope.add", target: { scopeId: payload.id }, payload, targetFiles, actor: args.actor });
  return { operationId, scopeId: payload.id };
}
