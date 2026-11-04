import { prisma } from "@/lib/prisma";
import { AuthenticationCreds, AuthenticationState, BufferJSON, initAuthCreds, SignalDataTypeMap } from "@whiskeysockets/baileys";
import { encryptData, decryptData, isEncryptedData } from "@/lib/crypto";

/**
 * Load Baileys credentials from the database. Missing rows mean a first pairing;
 * database, ciphertext and JSON errors are fatal so a broken session is never
 * silently replaced by a new identity.
 */
export const loadPrismaAuthState = async (sessionId: string, tenantId: string): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {
    const readData = async (type: string, id: string) => {
        const key = `${type}-${id}`;
        const data = await prisma.authState.findUnique({
            where: { sessionId_key: { sessionId, key } }
        });
        if (!data) return null;
        if (data.tenantId !== tenantId) throw new Error("WhatsApp auth state tenant mismatch");
        if (data.value == null) return null;

        const raw = typeof data.value === "string" ? data.value : JSON.stringify(data.value);
        if (!raw) throw new Error(`Stored WhatsApp auth state is empty (${type})`);
        try {
            if (!isEncryptedData(raw) && process.env.NODE_ENV === "production") {
                throw new Error("Legacy plaintext WhatsApp auth state requires an explicit migration");
            }
            const value = JSON.parse(decryptData(raw), BufferJSON.reviver);
            // Existing deployments may contain legacy plaintext rows. Read them
            // once, then immediately replace the row with authenticated ciphertext.
            if (!isEncryptedData(raw)) {
                await prisma.authState.update({
                    where: { sessionId_key: { sessionId, key }, tenantId },
                    data: { value: encryptData(JSON.stringify(value, BufferJSON.replacer)) },
                });
            }
            return value;
        } catch {
            throw new Error(`Stored WhatsApp auth state is corrupt or cannot be decrypted (${type})`);
        }
    };

    const encode = (data: unknown) => encryptData(JSON.stringify(data, BufferJSON.replacer));

    const creds = (await readData("creds", "me")) as AuthenticationCreds | null;
    const authenticationCreds = creds ?? initAuthCreds();

    return {
        state: {
            creds: authenticationCreds,
            keys: {
                get: async (type, ids) => {
                    const entries = await Promise.all(ids.map(async id => [id, await readData(type, id)] as const));
                    const result: { [key: string]: SignalDataTypeMap[typeof type] } = {};
                    for (const [id, value] of entries) {
                        if (value) result[id] = value as SignalDataTypeMap[typeof type];
                    }
                    return result;
                },
                set: async data => {
                    const operations: ReturnType<typeof prisma.authState.upsert>[] = [];
                    const deletes: ReturnType<typeof prisma.authState.deleteMany>[] = [];
                    for (const category of Object.keys(data)) {
                        const categoryData = data[category as keyof typeof data];
                        if (!categoryData) continue;
                        for (const [id, value] of Object.entries(categoryData)) {
                            const key = `${category}-${id}`;
                            if (value) {
                                const encrypted = encode(value);
                                operations.push(prisma.authState.upsert({
                                    where: { sessionId_key: { sessionId, key }, tenantId },
                                    create: { sessionId, tenantId, key, value: encrypted },
                                    update: { value: encrypted }
                                }));
                            } else {
                                deletes.push(prisma.authState.deleteMany({ where: { sessionId, tenantId, key } }));
                            }
                        }
                    }
                    const writes = [...operations, ...deletes];
                    if (writes.length) await prisma.$transaction(writes);
                }
            }
        },
        saveCreds: async () => {
            const key = "creds-me";
            const value = encode(authenticationCreds);
            await prisma.authState.upsert({
                where: { sessionId_key: { sessionId, key }, tenantId },
                create: { sessionId, tenantId, key, value },
                update: { value }
            });
        }
    };
};
