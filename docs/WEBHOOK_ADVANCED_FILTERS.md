# Advanced webhook filters

Webhook records can optionally store a nullable JSON `filters` object. A null value or a legacy row without this field has no filters and retains the previous delivery behavior. Configured criteria are combined with AND and use exact equality. Whitespace-only strings and null criteria are treated as absent; `false` is a real criterion.

Supported fields:

| Field | Supported event data | Meaning |
| --- | --- | --- |
| `sessionId` | All dispatches | Outer webhook payload session ID |
| `senderJid` | `message.received`, `message.sent` | Original `data.senderJid` before LID/phone normalization; compatibility fallback to `data.sender` or participant object `id`/`jid`; `sender: "ME"` maps to the own JID |
| `chatJid` | Message received/sent, status, edited, deleted | Original `data.chatJid` before normalization; compatibility fallback to `data.key.remoteJid` for message events or `data.remoteJid` for status/edit/delete |
| `messageType` | Message received/sent | `data.type`; Prisma `MessageType` enum plus `INTERACTIVE_RESPONSE`, `BUTTON_RESPONSE`, and `LIST_RESPONSE` emitted by the webhook layer |
| `fromMe` | Message received/sent | `data.key.fromMe` |
| `isGroup` | Message received/sent | `data.isGroup` |
| `chatType` | Message received/sent | `data.chatType`: PERSONAL, GROUP, STATUS, NEWSLETTER, UNKNOWN |

An event that does not carry a requested value does not match. For example, `messageType` filters do not match `group.update`. For group messages, `senderJid` uses the actual participant JID, not the group JID in `data.from`. For self-sent messages with `sender: "ME"`, it uses the account JID in `data.from`. JIDs compare literally; message payloads include additive `senderJid` and `chatJid` fields preserving the original IDs before compatibility normalization, so LID and phone JIDs remain distinct.

```json
{
  "filters": {
    "sessionId": "session-01",
    "chatJid": "120363123456789@g.us",
    "messageType": "IMAGE",
    "fromMe": false,
    "isGroup": true,
    "chatType": "GROUP"
  }
}
```

POST accepts omitted, null, or an object. PUT omission preserves stored criteria; PUT null or `{}` clears all; PUT object replaces all criteria. Invalid keys, value types, overlong values (`sessionId` max 191 characters; `senderJid` and `chatJid` max 512), and enum values return HTTP 400.

## Deployment and verification

`Webhook.filters Json?` is an additive nullable schema change. Generate the Prisma client from the updated schema, then apply the additive column change with `npm run db:push` only in an approved deployment environment after reviewing the target database. This command mutates the database. This implementation does not run migrations, `db push`, or mutate a database. Existing rows remain null and continue without filtering. No checked-in Prisma migration directory exists in this repository; confirm the production schema workflow before deployment.

Local verification evidence is recorded in the implementation handoff; no external webhook delivery is part of local tests.
