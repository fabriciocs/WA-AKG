export interface FamilyAccessTokenWhere {
  revokedAt: null;
  OR: [
    { familyId: string },
    { familyId: null; clientId: string; userId: string | null },
  ];
}

/** Narrowly select a grant family, retaining a bounded fallback for pre-family rows. */
export function familyAccessTokenWhere(token: { familyId: string; clientId: string; userId: string | null }): FamilyAccessTokenWhere {
  return {
    revokedAt: null,
    OR: [
      { familyId: token.familyId },
      // Transitional support for access tokens issued before familyId existed.
      // They expire within 15 minutes; only these legacy rows are grouped by subject.
      { familyId: null, clientId: token.clientId, userId: token.userId },
    ],
  };
}
