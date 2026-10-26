/** Return a useful message from an unknown thrown value without trusting its shape. */
export function errorMessage(error: unknown, fallback = "Unexpected error"): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return fallback;
}
