/**
 * Profile-picture guard is intentionally unavailable. The former implementation
 * only logged contacts.update events and did not compare, persist, or notify.
 * Keeping this module as an explicit unsupported marker prevents callers from
 * mistaking logging for an active guard.
 */
export const PP_GUARD_SUPPORTED = false;
