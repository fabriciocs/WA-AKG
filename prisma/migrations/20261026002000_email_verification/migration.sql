ALTER TABLE `User`
    ADD COLUMN `emailVerified` BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE `EmailVerificationToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmailVerificationToken_tokenHash_key`(`tokenHash`),
    INDEX `EmailVerificationToken_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `EmailVerificationToken_expiresAt_consumedAt_idx`(`expiresAt`, `consumedAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `EmailVerificationToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
