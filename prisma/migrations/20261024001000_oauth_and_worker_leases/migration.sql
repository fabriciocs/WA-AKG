-- AlterTable
ALTER TABLE `ScheduledMessage` ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `claimToken` VARCHAR(191) NULL,
    ADD COLUMN `claimedAt` DATETIME(3) NULL,
    ADD COLUMN `lastError` TEXT NULL;

-- AlterTable
ALTER TABLE `BroadcastLog` ADD COLUMN `claimToken` VARCHAR(191) NULL,
    ADD COLUMN `claimedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `BroadcastRecipient` ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `claimToken` VARCHAR(191) NULL,
    ADD COLUMN `claimedAt` DATETIME(3) NULL,
    ADD COLUMN `nextAttemptAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `OAuthClient` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `clientSecretHash` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `redirectUris` JSON NOT NULL,
    `allowedScopes` JSON NOT NULL,
    `grantTypes` JSON NOT NULL,
    `isConfidential` BOOLEAN NOT NULL DEFAULT true,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdById` VARCHAR(191) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OAuthClient_clientId_key`(`clientId`),
    INDEX `OAuthClient_createdById_idx`(`createdById`),
    INDEX `OAuthClient_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OAuthAuthorizationRequest` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `redirectUri` TEXT NOT NULL,
    `responseType` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `state` TEXT NULL,
    `codeChallenge` VARCHAR(191) NOT NULL,
    `codeChallengeMethod` VARCHAR(191) NOT NULL DEFAULT 'S256',
    `resource` TEXT NULL,
    `sessionScope` JSON NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `OAuthAuthorizationRequest_requestId_key`(`requestId`),
    INDEX `OAuthAuthorizationRequest_clientId_expiresAt_idx`(`clientId`, `expiresAt`),
    INDEX `OAuthAuthorizationRequest_userId_expiresAt_idx`(`userId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OAuthAuthorizationCode` (
    `id` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `redirectUri` TEXT NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `codeChallenge` VARCHAR(191) NOT NULL,
    `codeChallengeMethod` VARCHAR(191) NOT NULL DEFAULT 'S256',
    `resource` TEXT NULL,
    `sessionScope` JSON NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `OAuthAuthorizationCode_codeHash_key`(`codeHash`),
    INDEX `OAuthAuthorizationCode_clientId_expiresAt_idx`(`clientId`, `expiresAt`),
    INDEX `OAuthAuthorizationCode_userId_expiresAt_idx`(`userId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OAuthAccessToken` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `scope` VARCHAR(191) NOT NULL,
    `grantType` VARCHAR(191) NOT NULL,
    `familyId` VARCHAR(191) NULL,
    `sessionScope` JSON NULL,
    `resource` TEXT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,

    UNIQUE INDEX `OAuthAccessToken_tokenHash_key`(`tokenHash`),
    INDEX `OAuthAccessToken_clientId_expiresAt_idx`(`clientId`, `expiresAt`),
    INDEX `OAuthAccessToken_userId_expiresAt_idx`(`userId`, `expiresAt`),
    INDEX `OAuthAccessToken_familyId_idx`(`familyId`),
    INDEX `OAuthAccessToken_revokedAt_idx`(`revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OAuthRefreshToken` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `scope` VARCHAR(191) NOT NULL,
    `grantType` VARCHAR(191) NOT NULL,
    `sessionScope` JSON NULL,
    `resource` TEXT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `rotatedAt` DATETIME(3) NULL,
    `familyId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,

    UNIQUE INDEX `OAuthRefreshToken_tokenHash_key`(`tokenHash`),
    INDEX `OAuthRefreshToken_clientId_expiresAt_idx`(`clientId`, `expiresAt`),
    INDEX `OAuthRefreshToken_userId_expiresAt_idx`(`userId`, `expiresAt`),
    INDEX `OAuthRefreshToken_familyId_idx`(`familyId`),
    INDEX `OAuthRefreshToken_revokedAt_idx`(`revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OIDCIdentity` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `OIDCIdentity_userId_idx`(`userId`),
    UNIQUE INDEX `OIDCIdentity_provider_subject_key`(`provider`, `subject`),
    UNIQUE INDEX `OIDCIdentity_provider_userId_key`(`provider`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppSendThrottle` (
    `sessionId` VARCHAR(191) NOT NULL,
    `nextAllowedAt` DATETIME(3) NULL,
    `leaseToken` VARCHAR(191) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WhatsAppSendThrottle_leaseUntil_idx`(`leaseUntil`),
    PRIMARY KEY (`sessionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `ScheduledMessage_status_sendAt_idx` ON `ScheduledMessage`(`status`, `sendAt`);

-- CreateIndex
CREATE INDEX `ScheduledMessage_status_claimedAt_idx` ON `ScheduledMessage`(`status`, `claimedAt`);

-- CreateIndex
CREATE INDEX `BroadcastLog_status_claimedAt_idx` ON `BroadcastLog`(`status`, `claimedAt`);

-- CreateIndex
CREATE INDEX `BroadcastRecipient_broadcastLogId_status_idx` ON `BroadcastRecipient`(`broadcastLogId`, `status`);

-- CreateIndex
CREATE INDEX `BroadcastRecipient_status_claimedAt_idx` ON `BroadcastRecipient`(`status`, `claimedAt`);

-- CreateIndex
CREATE INDEX `BroadcastRecipient_status_nextAttemptAt_idx` ON `BroadcastRecipient`(`status`, `nextAttemptAt`);

-- AddForeignKey
ALTER TABLE `OAuthClient` ADD CONSTRAINT `OAuthClient_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthAuthorizationRequest` ADD CONSTRAINT `OAuthAuthorizationRequest_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `OAuthClient`(`clientId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthAuthorizationRequest` ADD CONSTRAINT `OAuthAuthorizationRequest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthAuthorizationCode` ADD CONSTRAINT `OAuthAuthorizationCode_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `OAuthClient`(`clientId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthAuthorizationCode` ADD CONSTRAINT `OAuthAuthorizationCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthAccessToken` ADD CONSTRAINT `OAuthAccessToken_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `OAuthClient`(`clientId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthAccessToken` ADD CONSTRAINT `OAuthAccessToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthRefreshToken` ADD CONSTRAINT `OAuthRefreshToken_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `OAuthClient`(`clientId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthRefreshToken` ADD CONSTRAINT `OAuthRefreshToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OIDCIdentity` ADD CONSTRAINT `OIDCIdentity_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
