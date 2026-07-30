import * as validators from "../generated/validators.mjs";

const exportNameByPublicName = {
  config: "validate_config",
  "plugin-lock": "validate_plugin_lock",
  scope: "validate_scope",
  guide: "validate_guide",
  release: "validate_release",
  "release-item": "validate_release_item",
  "execution-context": "validate_execution_context",
  environment: "validate_environment",
  source: "validate_source",
  "change-set": "validate_change_set",
  "discovery-proposal": "validate_discovery_proposal",
  operation: "validate_operation",
  event: "validate_event",
  result: "validate_result"
};

export function validate(schemaName, data) {
  const exportName = exportNameByPublicName[schemaName];
  if (!exportName) throw new Error(`unknown schema: ${schemaName}`);
  const validateFn = validators[exportName];
  const valid = validateFn(data);
  const errors = valid ? [] : (validateFn.errors || []).map((error) => ({
    path: error.instancePath || "",
    message: error.message || "invalid"
  }));
  return { valid, errors };
}
