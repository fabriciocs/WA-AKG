ALTER TABLE `Webhook`
    ADD COLUMN `allowLocal` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `requestHeaders` TEXT NULL;
