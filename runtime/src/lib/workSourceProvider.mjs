export const WORK_SOURCE_PROVIDER_CONTRACT_VERSION = 1;
export const WORK_SOURCE_CAPABILITIES = Object.freeze(["discover", "search", "get", "create", "update", "transition", "comment"]);
const KNOWN_CAPABILITIES = new Set(WORK_SOURCE_CAPABILITIES);

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function providerFromFactory(factory) {
  const provider = typeof factory === "function" ? factory() : factory;
  if (!provider || typeof provider !== "object" || typeof provider.provider !== "string") {
    throw new Error("Work Source provider factory must return an adapter with provider id");
  }
  if (provider.contractVersion !== WORK_SOURCE_PROVIDER_CONTRACT_VERSION) {
    throw new Error(`provider ${provider.provider} must implement Work Source contract version ${WORK_SOURCE_PROVIDER_CONTRACT_VERSION}`);
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

function cloneSource(source) {
  return {
    ...source,
    roots: (source.roots || []).map((root) => ({ ...root })),
    capabilities: [...(source.capabilities || [])],
    options: { ...(source.options || {}), ...(source.options?.file_globs ? { file_globs: [...source.options.file_globs] } : {}) }
  };
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
  for (const rawSource of [...(sources || [])].sort((left, right) => compareUtf8(left.id, right.id))) {
    if (sourceIds.has(rawSource.id)) throw new Error(`duplicate Work Source id: ${rawSource.id}`);
    sourceIds.add(rawSource.id);
    const provider = providers.get(rawSource.provider);
    if (!provider) throw new Error(`unknown Work Source provider: ${rawSource.provider}`);
    const capabilities = validateCapabilities(`work source ${rawSource.id}`, rawSource.capabilities || []);
    for (const capability of capabilities) {
      if (!provider.capabilities.includes(capability)) {
        throw new Error(`work source ${rawSource.id} declares capability ${capability} unavailable from provider ${rawSource.provider}`);
      }
      if (typeof provider[capability] !== "function") {
        throw new Error(`work source ${rawSource.id} declares capability ${capability} without implementation`);
      }
    }
    activeSources.push(cloneSource({ ...rawSource, capabilities }));
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
      return activeSources.map(cloneSource);
    },
    getSource(sourceId) {
      return cloneSource(findSource(sourceId));
    },
    inspect(sourceId) {
      const source = findSource(sourceId);
      const provider = providers.get(source.provider);
      return {
        source: cloneSource(source),
        provider: provider.provider,
        contractVersion: provider.contractVersion,
        providerCapabilities: [...provider.capabilities]
      };
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
