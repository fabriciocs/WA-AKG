import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/oauth/token/route";

test("OAuth token endpoint rejects the disabled client_credentials grant before client lookup", async () => {
  const request = new NextRequest("http://localhost/api/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&client_id=disabled-test-client",
  });
  const response = await POST(request);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "unsupported_grant_type",
    error_description: "The client_credentials grant is not supported",
  });
});
