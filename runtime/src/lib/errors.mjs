export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

export class StateError extends Error {
  constructor(message) {
    super(message);
    this.name = "StateError";
  }
}

export class StaleError extends Error {
  constructor(message) {
    super(message);
    this.name = "StaleError";
  }
}
