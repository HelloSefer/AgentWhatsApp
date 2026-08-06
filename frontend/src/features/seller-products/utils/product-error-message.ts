export function productErrorMessage(error: unknown): string { return error instanceof Error && error.message ? error.message : "Products are temporarily unavailable. Please try again."; }
