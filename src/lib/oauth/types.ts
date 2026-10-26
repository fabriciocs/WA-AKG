export const OAuthScope = {
  API_READ: "api:read",
  API_WRITE: "api:write",
  MCP_READ: "mcp:read",
  MCP_WRITE: "mcp:write",
  SESSIONS_READ: "sessions:read",
} as const;

export type OAuthScopeName = (typeof OAuthScope)[keyof typeof OAuthScope];
export type OAuthGrantType = "authorization_code" | "refresh_token" | "client_credentials";

export interface OAuthClientRecord {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  redirectUris: string[];
  allowedScopes: string[];
  grantTypes: OAuthGrantType[];
  isConfidential: boolean;
  isActive: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope: string;
  tokenType: "Bearer";
}

export interface OAuthPrincipal {
  tokenId: string;
  clientId: string;
  userId: string | null;
  scope: string[];
  sessionScope: string[] | null;
  resource: string | null;
  expiresAt: Date;
}

export class OAuthError extends Error {
  constructor(
    message: string,
    public readonly code = "invalid_request",
    public readonly status = 400,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}
