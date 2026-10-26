import { createDcrRegistrationHandler } from "@/lib/oauth/dcr-registration";

export const runtime = "nodejs";
export const POST = createDcrRegistrationHandler();
