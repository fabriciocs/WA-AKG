import test from "node:test";
import assert from "node:assert/strict";
import { signOutToLogin } from "@/components/dashboard/sign-out";

test("sign-out navigates to the local login path despite a remote Auth.js response URL", async () => {
    let navigated = "";
    await signOutToLogin("", async options => {
        assert.deepEqual(options, { redirect: false, redirectTo: "/auth/login" });
        return { url: "https://external.example.test/" };
    }, href => { navigated = href; });
    assert.equal(navigated, "/auth/login");
});

test("sign-out preserves the proxy base path for both callback and navigation", async () => {
    let navigated = "";
    await signOutToLogin("/wa-akg", async options => {
        assert.deepEqual(options, { redirect: false, redirectTo: "/wa-akg/auth/login" });
        return { url: "https://external.example.test/" };
    }, href => { navigated = href; });
    assert.equal(navigated, "/wa-akg/auth/login");
});

test("sign-out does not navigate when the server did not confirm the request", async () => {
    let navigated = false;
    await assert.rejects(
        signOutToLogin("", async () => ({}), () => { navigated = true; }),
        /did not confirm sign-out/,
    );
    assert.equal(navigated, false);
});

test("sign-out does not navigate when the request throws", async () => {
    let navigated = false;
    await assert.rejects(
        signOutToLogin("", async () => { throw new Error("network error"); }, () => { navigated = true; }),
        /network error/,
    );
    assert.equal(navigated, false);
});
