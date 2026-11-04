import { createServer } from "node:http";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encode } from "next-auth/jwt";
import { Server } from "socket.io";
import { io as connect, type Socket } from "socket.io-client";
import { prisma } from "@/lib/prisma";
import {
    createPrivateConnectionUpdate,
    createPublicConnectionUpdate,
    emitSessionRoomEvent,
    getSessionPrivateRoom,
    getSessionPublicRoom,
    setupSocket,
} from "../../server/socket";

describe("Socket.IO session secret isolation", () => {
    it("separates rooms by tenant and event visibility", () => {
        assert.equal(getSessionPublicRoom("tenant-a", "session-1"), "tenant:tenant-a:session:public:session-1");
        assert.equal(getSessionPrivateRoom("tenant-a", "session-1"), "tenant:tenant-a:session:private:session-1");
        assert.notEqual(getSessionPublicRoom("tenant-a", "session-1"), getSessionPublicRoom("tenant-b", "session-1"));
        assert.notEqual(getSessionPublicRoom("tenant-a", "session-1"), getSessionPrivateRoom("tenant-a", "session-1"));
    });

    it("does not put secrets in public connection updates", () => {
        assert.deepEqual(createPublicConnectionUpdate("SCAN_QR"), { status: "SCAN_QR" });
        assert.deepEqual(createPrivateConnectionUpdate("SCAN_QR", "qr-secret", "pair-secret"),
            { status: "SCAN_QR", qr: "qr-secret", pairingCode: "pair-secret" });
    });

    it("denies cross-tenant room joins and evicts a revoked owner before the next event", { timeout: 10000 }, async (t) => {
        const previousSecret = process.env.AUTH_SECRET;
        const secret = "synthetic-socket-fixture-for-tenant-room-test";
        process.env.AUTH_SECRET = secret;
        t.after(() => {
            if (previousSecret === undefined) delete process.env.AUTH_SECRET;
            else process.env.AUTH_SECRET = previousSecret;
        });

        const session = { id: "session-db", sessionId: "session-1", tenantId: "tenant-a", userId: "owner-a" };
        const users = [
            { id: "owner-a", role: "USER", emailVerified: true },
            { id: "member-a", role: "USER", emailVerified: true },
            { id: "admin-b", role: "SUPERADMIN", emailVerified: true },
        ];
        let ownerActive = true;
        const restores: Array<() => void> = [];
        const mockDelegate = (delegate: object, method: string, replacement: unknown) => {
            const original = Object.getOwnPropertyDescriptor(delegate, method);
            Object.defineProperty(delegate, method, { configurable: true, value: replacement });
            restores.push(() => original ? Object.defineProperty(delegate, method, original) : Reflect.deleteProperty(delegate, method));
        };
        t.after(() => { for (const restore of restores.reverse()) restore(); });
        mockDelegate(prisma.user, "findUnique", async ({ where }: { where: { id: string } }) =>
            users.find(user => user.id === where.id) ?? null);
        mockDelegate(prisma.tenantMembership, "findFirst", async ({ where }: { where: { userId: string; tenantId: string } }) =>
            (where.tenantId === "tenant-a" && (where.userId === "member-a" || (where.userId === "owner-a" && ownerActive))) ||
            (where.tenantId === "tenant-b" && where.userId === "admin-b")
                ? { tenantId: where.tenantId, role: "OWNER", status: "ACTIVE" }
                : null);
        mockDelegate(prisma.session, "findFirst", async ({ where }: { where: { tenantId: string } }) =>
            where.tenantId === session.tenantId ? session : null);
        mockDelegate(prisma.session, "findUnique", async ({ where }: { where: { tenantId: string } }) =>
            where.tenantId === session.tenantId ? session : null);
        mockDelegate(prisma.resourceGrant, "findMany", async () => []);

        const http = createServer();
        const io = new Server(http);
        setupSocket(io);
        const clients: Socket[] = [];
        t.after(async () => {
            for (const client of clients) client.disconnect();
            await io.close();
        });

        await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
        const address = http.address();
        assert.ok(address && typeof address === "object");
        const { port } = address;

        async function openSocket(userId: string, tenantId: string) {
            const name = "authjs.session-token";
            const token = await encode({ token: { id: userId }, secret, salt: name });
            const client = connect(`http://127.0.0.1:${port}`, {
                forceNew: true,
                extraHeaders: { cookie: `${name}=${token}; wa-akg-tenant=${tenantId}` },
            });
            clients.push(client);
            await new Promise<void>((resolve, reject) => {
                client.once("connect", resolve);
                client.once("connect_error", reject);
            });
            return client;
        }

        const owner = await openSocket("owner-a", "tenant-a");
        const member = await openSocket("member-a", "tenant-a");
        const admin = await openSocket("admin-b", "tenant-b");

        for (const denied of [member, admin]) {
            const rejection = new Promise(resolve => denied.once("error", resolve));
            denied.emit("join-session", session.sessionId);
            assert.deepEqual(await rejection, { message: "Forbidden - Cannot access this session" });
        }

        const privateRoom = getSessionPrivateRoom(session.tenantId, session.sessionId);
        const roomJoined = new Promise<void>(resolve => {
            io.of("/").adapter.on("join-room", (room, socketId) => {
                if (room === privateRoom && socketId === owner.id) resolve();
            });
        });
        owner.emit("join-session", session.sessionId);
        await roomJoined;

        const firstEvent = new Promise(resolve => owner.once("connection.update", resolve));
        const payload = createPrivateConnectionUpdate("SCAN_QR", "fixture-only");
        await emitSessionRoomEvent(io, session.tenantId, session.sessionId, "connection.update", payload, "private");
        assert.deepEqual(await firstEvent, payload);

        ownerActive = false;
        await emitSessionRoomEvent(io, session.tenantId, session.sessionId, "connection.update", payload, "private");
        assert.equal((await io.in(privateRoom).fetchSockets()).length, 0);
    });
});
