export function applyWithRecovery(operation, state, failurePoint = null) {
  const next = { ...state, journal: [...state.journal] };
  if (next.journal.includes(operation.id)) return { ...next, replayed: true };
  next.journal.push(`${operation.id}:started`);
  if (failurePoint === "before-record") return { ...next, recovered: true };
  next.files = { ...next.files, ...operation.files };
  if (failurePoint === "after-apply") return { ...next, recovered: true };
  next.journal.push(`${operation.id}:committed`);
  return next;
}

export function recover(state, operation) {
  if (state.journal.includes(`${operation.id}:committed`)) return { ...state, replayed: true };
  return applyWithRecovery(operation, state);
}
