export class ConversationConfigValidationError extends Error {
  constructor() {
    super("Conversation configuration is invalid.");
    this.name = "ConversationConfigValidationError";
  }
}

export class ConversationConfigSellerNotFoundError extends Error {
  constructor() {
    super("The conversation configuration seller was not found.");
    this.name = "ConversationConfigSellerNotFoundError";
  }
}

export class ConversationConfigProductNotFoundError extends Error {
  constructor() {
    super("The conversation configuration product was not found.");
    this.name = "ConversationConfigProductNotFoundError";
  }
}

export class ConversationConfigCorruptedError extends Error {
  constructor() {
    super("Stored conversation configuration is corrupted.");
    this.name = "ConversationConfigCorruptedError";
  }
}

export class ConversationConfigPersistenceError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("Conversation configuration persistence failed.");
    this.name = "ConversationConfigPersistenceError";
    this.cause = cause;
  }
}
