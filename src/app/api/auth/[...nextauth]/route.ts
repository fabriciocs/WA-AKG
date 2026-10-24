import { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
type AuthHandler = (request: NextRequest) => Promise<Response>;

function withBasePath(handler: AuthHandler): AuthHandler {
  return async (request: NextRequest) => {
    if (!basePath) return handler(request);

    const url = new URL(request.url);
    if (url.pathname !== basePath && !url.pathname.startsWith(basePath + "/")) {
      url.pathname = basePath + url.pathname;
    }

    const init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = {
      method: request.method,
      headers: request.headers,
      redirect: request.redirect,
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    return handler(new NextRequest(url, init));
  };
}

export const GET = withBasePath(handlers.GET);
export const POST = withBasePath(handlers.POST);
