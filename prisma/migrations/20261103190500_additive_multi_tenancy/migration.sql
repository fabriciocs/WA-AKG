-- AlterTable
ALTER TABLE `Session` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Contact` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Message` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Group` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `AutoReply` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Story` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `ScheduledMessage` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `AuthState` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Webhook` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `WebhookLog` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `InboundEvent` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `ProcessingResult` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `BotConfig` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Label` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `ChatLabel` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Notification` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `SessionAccess` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `OAuthClient` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `OAuthAuthorizationRequest` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `OAuthAuthorizationCode` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `OAuthAccessToken` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `OAuthRefreshToken` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `OAuthGrant` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `OAuthGrantSessionCapability` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `BroadcastLog` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `BroadcastRecipient` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `WhatsAppSendThrottle` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `WhatsAppSessionLease` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `OutboundMessageOperation` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Tenant` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'ARCHIVED', 'PENDING_DELETION') NOT NULL DEFAULT 'ACTIVE',
    `suspendedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Tenant_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantMembership` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'ADMIN', 'MEMBER', 'VIEWER') NOT NULL DEFAULT 'MEMBER',
    `status` ENUM('ACTIVE', 'REVOKED', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `membershipVersion` INTEGER NOT NULL DEFAULT 1,

    INDEX `TenantMembership_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `TenantMembership_userId_status_idx`(`userId`, `status`),
    UNIQUE INDEX `TenantMembership_tenantId_userId_key`(`tenantId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantInvitation` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'ADMIN', 'MEMBER', 'VIEWER') NOT NULL DEFAULT 'MEMBER',
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TenantInvitation_tokenHash_key`(`tokenHash`),
    INDEX `TenantInvitation_tenantId_email_idx`(`tenantId`, `email`),
    INDEX `TenantInvitation_tenantId_expiresAt_revokedAt_idx`(`tenantId`, `expiresAt`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantSettings` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NULL,
    `timezone` VARCHAR(191) NULL,
    `locale` VARCHAR(191) NULL,
    `branding` JSON NULL,
    `registrationPolicy` JSON NULL,
    `retentionPolicy` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TenantSettings_tenantId_key`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ResourceGrant` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `resourceType` VARCHAR(191) NOT NULL,
    `resourceId` VARCHAR(191) NOT NULL,
    `principalUserId` VARCHAR(191) NULL,
    `capabilities` JSON NOT NULL,
    `grantedBy` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ResourceGrant_tenantId_resourceType_resourceId_idx`(`tenantId`, `resourceType`, `resourceId`),
    INDEX `ResourceGrant_tenantId_principalUserId_idx`(`tenantId`, `principalUserId`),
    INDEX `ResourceGrant_tenantId_revokedAt_expiresAt_idx`(`tenantId`, `revokedAt`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiCredential` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `keyHash` VARCHAR(191) NOT NULL,
    `keyPrefix` VARCHAR(191) NOT NULL,
    `scopes` JSON NULL,
    `expiresAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ApiCredential_keyHash_key`(`keyHash`),
    INDEX `ApiCredential_tenantId_userId_idx`(`tenantId`, `userId`),
    INDEX `ApiCredential_tenantId_revokedAt_expiresAt_idx`(`tenantId`, `revokedAt`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditEvent` (
    `id` VARCHAR(191) NOT NULL,
    `actorUserId` VARCHAR(191) NULL,
    `tenantId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `reason` TEXT NULL,
    `resourceType` VARCHAR(191) NULL,
    `resourceId` VARCHAR(191) NULL,
    `requestId` VARCHAR(191) NULL,
    `outcome` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditEvent_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `AuditEvent_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`),
    INDEX `AuditEvent_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminAccessEvent` (
    `id` VARCHAR(191) NOT NULL,
    `actorUserId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `resourceType` VARCHAR(191) NULL,
    `resourceId` VARCHAR(191) NULL,
    `requestId` VARCHAR(191) NULL,
    `outcome` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminAccessEvent_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `AdminAccessEvent_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`),
    INDEX `AdminAccessEvent_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Session_tenantId_userId_idx` ON `Session`(`tenantId`, `userId`);

-- CreateIndex
CREATE INDEX `Contact_tenantId_sessionId_jid_idx` ON `Contact`(`tenantId`, `sessionId`, `jid`);

-- CreateIndex
CREATE INDEX `Message_tenantId_sessionId_remoteJid_idx` ON `Message`(`tenantId`, `sessionId`, `remoteJid`);

-- CreateIndex
CREATE INDEX `Message_tenantId_sessionId_remoteJid_timestamp_idx` ON `Message`(`tenantId`, `sessionId`, `remoteJid`, `timestamp`);

-- CreateIndex
CREATE INDEX `Group_tenantId_sessionId_jid_idx` ON `Group`(`tenantId`, `sessionId`, `jid`);

-- CreateIndex
CREATE INDEX `AutoReply_tenantId_sessionId_keyword_idx` ON `AutoReply`(`tenantId`, `sessionId`, `keyword`);

-- CreateIndex
CREATE INDEX `Story_tenantId_sessionId_timestamp_idx` ON `Story`(`tenantId`, `sessionId`, `timestamp`);

-- CreateIndex
CREATE INDEX `ScheduledMessage_tenantId_status_sendAt_idx` ON `ScheduledMessage`(`tenantId`, `status`, `sendAt`);

-- CreateIndex
CREATE INDEX `ScheduledMessage_tenantId_status_claimedAt_idx` ON `ScheduledMessage`(`tenantId`, `status`, `claimedAt`);

-- CreateIndex
CREATE INDEX `AuthState_tenantId_sessionId_key_idx` ON `AuthState`(`tenantId`, `sessionId`, `key`);

-- CreateIndex
CREATE INDEX `Webhook_tenantId_userId_idx` ON `Webhook`(`tenantId`, `userId`);

-- CreateIndex
CREATE INDEX `Webhook_tenantId_sessionId_idx` ON `Webhook`(`tenantId`, `sessionId`);

-- CreateIndex
CREATE INDEX `WebhookLog_tenantId_webhookId_createdAt_idx` ON `WebhookLog`(`tenantId`, `webhookId`, `createdAt`);

-- CreateIndex
CREATE INDEX `InboundEvent_tenantId_sessionId_receivedAt_idx` ON `InboundEvent`(`tenantId`, `sessionId`, `receivedAt`);

-- CreateIndex
CREATE INDEX `ProcessingResult_tenantId_sessionId_status_createdAt_idx` ON `ProcessingResult`(`tenantId`, `sessionId`, `status`, `createdAt`);

-- CreateIndex
CREATE INDEX `ProcessingResult_tenantId_sessionPublicId_createdAt_idx` ON `ProcessingResult`(`tenantId`, `sessionPublicId`, `createdAt`);

-- CreateIndex
CREATE INDEX `BotConfig_tenantId_sessionId_idx` ON `BotConfig`(`tenantId`, `sessionId`);

-- CreateIndex
CREATE INDEX `Label_tenantId_sessionId_idx` ON `Label`(`tenantId`, `sessionId`);

-- CreateIndex
CREATE INDEX `ChatLabel_tenantId_labelId_chatJid_idx` ON `ChatLabel`(`tenantId`, `labelId`, `chatJid`);

-- CreateIndex
CREATE INDEX `Notification_tenantId_userId_createdAt_idx` ON `Notification`(`tenantId`, `userId`, `createdAt`);

-- CreateIndex
CREATE INDEX `SessionAccess_tenantId_sessionId_userId_idx` ON `SessionAccess`(`tenantId`, `sessionId`, `userId`);

-- CreateIndex
CREATE INDEX `OAuthClient_tenantId_createdById_idx` ON `OAuthClient`(`tenantId`, `createdById`);

-- CreateIndex
CREATE INDEX `OAuthClient_tenantId_isActive_idx` ON `OAuthClient`(`tenantId`, `isActive`);

-- CreateIndex
CREATE INDEX `OAuthAuthorizationRequest_tenantId_clientId_expiresAt_idx` ON `OAuthAuthorizationRequest`(`tenantId`, `clientId`, `expiresAt`);

-- CreateIndex
CREATE INDEX `OAuthAuthorizationRequest_tenantId_userId_expiresAt_idx` ON `OAuthAuthorizationRequest`(`tenantId`, `userId`, `expiresAt`);

-- CreateIndex
CREATE INDEX `OAuthAuthorizationCode_tenantId_clientId_expiresAt_idx` ON `OAuthAuthorizationCode`(`tenantId`, `clientId`, `expiresAt`);

-- CreateIndex
CREATE INDEX `OAuthAuthorizationCode_tenantId_userId_expiresAt_idx` ON `OAuthAuthorizationCode`(`tenantId`, `userId`, `expiresAt`);

-- CreateIndex
CREATE INDEX `OAuthAuthorizationCode_tenantId_grantId_idx` ON `OAuthAuthorizationCode`(`tenantId`, `grantId`);

-- CreateIndex
CREATE INDEX `OAuthAccessToken_tenantId_clientId_expiresAt_idx` ON `OAuthAccessToken`(`tenantId`, `clientId`, `expiresAt`);

-- CreateIndex
CREATE INDEX `OAuthAccessToken_tenantId_userId_expiresAt_idx` ON `OAuthAccessToken`(`tenantId`, `userId`, `expiresAt`);

-- CreateIndex
CREATE INDEX `OAuthAccessToken_tenantId_grantId_idx` ON `OAuthAccessToken`(`tenantId`, `grantId`);

-- CreateIndex
CREATE INDEX `OAuthRefreshToken_tenantId_clientId_expiresAt_idx` ON `OAuthRefreshToken`(`tenantId`, `clientId`, `expiresAt`);

-- CreateIndex
CREATE INDEX `OAuthRefreshToken_tenantId_userId_expiresAt_idx` ON `OAuthRefreshToken`(`tenantId`, `userId`, `expiresAt`);

-- CreateIndex
CREATE INDEX `OAuthRefreshToken_tenantId_grantId_idx` ON `OAuthRefreshToken`(`tenantId`, `grantId`);

-- CreateIndex
CREATE INDEX `OAuthGrant_tenantId_userId_revokedAt_idx` ON `OAuthGrant`(`tenantId`, `userId`, `revokedAt`);

-- CreateIndex
CREATE INDEX `OAuthGrant_tenantId_clientId_revokedAt_idx` ON `OAuthGrant`(`tenantId`, `clientId`, `revokedAt`);

-- CreateIndex
CREATE INDEX `OAuthGrantSessionCapability_tenantId_grantId_sessionId_idx` ON `OAuthGrantSessionCapability`(`tenantId`, `grantId`, `sessionId`);

-- CreateIndex
CREATE INDEX `BroadcastLog_tenantId_sessionId_idx` ON `BroadcastLog`(`tenantId`, `sessionId`);

-- CreateIndex
CREATE INDEX `BroadcastLog_tenantId_sessionId_startedAt_idx` ON `BroadcastLog`(`tenantId`, `sessionId`, `startedAt`);

-- CreateIndex
CREATE INDEX `BroadcastRecipient_tenantId_broadcastLogId_status_idx` ON `BroadcastRecipient`(`tenantId`, `broadcastLogId`, `status`);

-- CreateIndex
CREATE INDEX `BroadcastRecipient_tenantId_status_claimedAt_idx` ON `BroadcastRecipient`(`tenantId`, `status`, `claimedAt`);

-- CreateIndex
CREATE INDEX `BroadcastRecipient_tenantId_status_nextAttemptAt_idx` ON `BroadcastRecipient`(`tenantId`, `status`, `nextAttemptAt`);

-- CreateIndex
CREATE INDEX `WhatsAppSendThrottle_tenantId_sessionId_idx` ON `WhatsAppSendThrottle`(`tenantId`, `sessionId`);

-- CreateIndex
CREATE INDEX `WhatsAppSessionLease_tenantId_sessionId_idx` ON `WhatsAppSessionLease`(`tenantId`, `sessionId`);

-- CreateIndex
CREATE INDEX `outbound_op_tenant_session_idx` ON `OutboundMessageOperation`(`tenantId`, `sessionDbId`, `createdAt`);

-- CreateIndex
CREATE INDEX `outbound_op_tenant_user_session_idx` ON `OutboundMessageOperation`(`tenantId`, `userId`, `sessionDbId`, `createdAt`);

-- AddForeignKey
ALTER TABLE `TenantMembership` ADD CONSTRAINT `TenantMembership_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantMembership` ADD CONSTRAINT `TenantMembership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantInvitation` ADD CONSTRAINT `TenantInvitation_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantSettings` ADD CONSTRAINT `TenantSettings_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResourceGrant` ADD CONSTRAINT `ResourceGrant_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResourceGrant` ADD CONSTRAINT `ResourceGrant_principalUserId_fkey` FOREIGN KEY (`principalUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResourceGrant` ADD CONSTRAINT `ResourceGrant_grantedBy_fkey` FOREIGN KEY (`grantedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiCredential` ADD CONSTRAINT `ApiCredential_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiCredential` ADD CONSTRAINT `ApiCredential_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditEvent` ADD CONSTRAINT `AuditEvent_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditEvent` ADD CONSTRAINT `AuditEvent_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminAccessEvent` ADD CONSTRAINT `AdminAccessEvent_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminAccessEvent` ADD CONSTRAINT `AdminAccessEvent_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Group` ADD CONSTRAINT `Group_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AutoReply` ADD CONSTRAINT `AutoReply_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Story` ADD CONSTRAINT `Story_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScheduledMessage` ADD CONSTRAINT `ScheduledMessage_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthState` ADD CONSTRAINT `AuthState_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Webhook` ADD CONSTRAINT `Webhook_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebhookLog` ADD CONSTRAINT `WebhookLog_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InboundEvent` ADD CONSTRAINT `InboundEvent_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProcessingResult` ADD CONSTRAINT `ProcessingResult_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BotConfig` ADD CONSTRAINT `BotConfig_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Label` ADD CONSTRAINT `Label_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatLabel` ADD CONSTRAINT `ChatLabel_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionAccess` ADD CONSTRAINT `SessionAccess_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthClient` ADD CONSTRAINT `OAuthClient_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthAuthorizationRequest` ADD CONSTRAINT `OAuthAuthorizationRequest_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthAuthorizationCode` ADD CONSTRAINT `OAuthAuthorizationCode_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthAccessToken` ADD CONSTRAINT `OAuthAccessToken_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthRefreshToken` ADD CONSTRAINT `OAuthRefreshToken_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthGrant` ADD CONSTRAINT `OAuthGrant_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthGrantSessionCapability` ADD CONSTRAINT `OAuthGrantSessionCapability_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BroadcastLog` ADD CONSTRAINT `BroadcastLog_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BroadcastRecipient` ADD CONSTRAINT `BroadcastRecipient_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppSendThrottle` ADD CONSTRAINT `WhatsAppSendThrottle_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppSessionLease` ADD CONSTRAINT `WhatsAppSessionLease_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OutboundMessageOperation` ADD CONSTRAINT `OutboundMessageOperation_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
