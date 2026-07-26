export { runDiscoverScan, DEFAULT_MAX_SOURCE_BYTES, MIN_MAX_SOURCE_BYTES, MAX_MAX_SOURCE_BYTES } from "../lib/discoverScan.mjs";
import { UsageError } from "../lib/errors.mjs";
import { validateDiscoveryProposal } from "../lib/discoveryProposal.mjs";

export function runDiscoverValidate({ planningRoot, workspaceRoot, proposalText }) {
  let proposal;
  try {
    proposal = JSON.parse(proposalText);
  } catch (error) {
    throw new UsageError(`invalid proposal JSON: ${error.message}`);
  }
  return validateDiscoveryProposal({ proposal, planningRoot, workspaceRoot });
}
