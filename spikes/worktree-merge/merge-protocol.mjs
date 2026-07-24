export function mergeAggregates(left, right) {
  const merged = new Map(left.map((entry) => [entry.id, entry]));
  for (const entry of right) {
    const current = merged.get(entry.id);
    if (current && JSON.stringify(current) !== JSON.stringify(entry)) {
      throw new Error(`conflict:${entry.id}`);
    }
    merged.set(entry.id, entry);
  }
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function regenerateIndex(aggregates) {
  return aggregates.map(({ id, display_id, slug }) => ({ id, display_id, slug })).sort((a, b) => a.id.localeCompare(b.id));
}
