export const WORK_SOURCE_CAPABILITIES = Object.freeze(["discover", "search", "get", "create", "update", "transition", "comment"]);
const KNOWN_CAPABILITIES = new Set(WORK_SOURCE_CAPABILITIES);

function providerFromFactory(factory) {
  const provider = typeof factory === "function" ? factory() : factory;
  if (!provider || typeof provider !== "object" || typeof provider.provider !== "string") {
    throw new Error("Work Source provider factory must return an adapter with provider id");
  }
  return provider;
}

function validateCapabilities(owner, capabilities) {
  if (!Array.isArray(capabilities)) throw new Error(`${owner} capabilities must be an array`);
  const seen = new Set();
  for (const capability of capabilities) {
    if (!KNOWN_CAPABILITIES.has(capability)) throw new Error(`${owner} declares unknown capability ${capability}`);
    if (seen.has(capability)) throw new Error(`${owner} declares duplicate capability ${capability}`);
    seen.add(capability);
  }
  return [...seen].sort((left, right) => WORK_SOURCE_CAPABILITIES.indexOf(left) - WORK_SOURCE_CAPABILITIES.indexOf(right));
}

export function buildWorkSourceRegistry({ providerFactories, sources }) {
  const providers = new Map();
  for (const factory of providerFactories) {
    const provider = providerFromFactory(factory);
    if (providers.has(provider.provider)) throw new Error(`duplicate Work Source provider: ${provider.provider}`);
    const capabilities = validateCapabilities(`provider ${provider.provider}`, provider.capabilities || []);
    for (const capability of capabilities) {
      if (typeof provider[capability] !== "function") {
        throw new Error(`provider ${provider.provider} declares capability ${capability} without implementation`);
      }
    }
    provider.capabilities = capabilities;
    providers.set(provider.provider, provider);
  }

  const sourceIds = new Set();
  const activeSources = [];
  for (const source of [...(sources || [])].sort((left, right) => left.id.localeCompare(right.id))) {
    if (sourceIds.has(source.id)) throw new Error(`duplicate Work Source id: ${source.id}`);
    sourceIds.add(source.id);
    const provider = providers.get(source.provider);
    if (!provider) throw new Error(`unknown Work Source provider: ${source.provider}`);
    const capabilities = validateCapabilities(`work source ${source.id}`, source.capabilities || []);
    for (const capability of capabilities) {
      if (!provider.capabilities.includes(capability)) {
        throw new Error(`work source ${source.id} declares capability ${capability} unavailable from provider ${source.provider}`);
      }
      if (typeof provider[capability] !== "function") {
        throw new Error(`work source ${source.id} declares capability ${capability} without implementation`);
      }
    }
    activeSources.push({ ...source, capabilities });
  }

  function findSource(sourceId) {
    const source = activeSources.find((entry) => entry.id === sourceId);
    if (!source) {
      const error = new Error(`SOURCE_NOT_FOUND: Work Source ${sourceId} is not configured`);
      error.code = "SOURCE_NOT_FOUND";
      throw error;
    }
    return source;
  }

  return {
    listSources() {
      return activeSources.map((source) => ({ ...source, capabilities: [...source.capabilities] }));
    },
    getSource(sourceId) {
      return findSource(sourceId);
    },
    resolve(sourceId, capability) {
      if (!KNOWN_CAPABILITIES.has(capability)) throw new Error(`unknown Work Source capability ${capability}`);
      const source = findSource(sourceId);
      if (!source.enabled) {
        const error = new Error(`SOURCE_UNAVAILABLE: Work Source ${sourceId} is disabled`);
        error.code = "SOURCE_UNAVAILABLE";
        throw error;
      }
      if (!source.capabilities.includes(capability)) {
        const error = new Error(`SOURCE_CAPABILITY_MISSING: Work Source ${sourceId} does not declare ${capability}`);
        error.code = "SOURCE_CAPABILITY_MISSING";
        throw error;
      }
      const provider = providers.get(source.provider);
      if (!provider || typeof provider[capability] !== "function") {
        const error = new Error(`SOURCE_CAPABILITY_MISSING: Provider ${source.provider} cannot execute ${capability}`);
        error.code = "SOURCE_CAPABILITY_MISSING";
        throw error;
      }
      return provider;
    }
  };
}
