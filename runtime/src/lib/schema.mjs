import * as validators from "../generated/validators.mjs";

const exportNameByPublicName = {
  config: "validate_config",
  "plugin-lock": "validate_plugin_lock",
  scope: "validate_scope",
  "change-set": "validate_change_set",
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
