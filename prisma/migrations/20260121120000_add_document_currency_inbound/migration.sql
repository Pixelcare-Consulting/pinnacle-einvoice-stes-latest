-- Add documentCurrency to WP_INBOUND_STATUS so Total Sales can show DocumentCurrencyCode + amount (e.g. USD 705.60).
-- Safe to run if column already exists: no-op when column is present.
IF COL_LENGTH('dbo.WP_INBOUND_STATUS', 'documentCurrency') IS NULL
BEGIN
    ALTER TABLE [dbo].[WP_INBOUND_STATUS] ADD [documentCurrency] VARCHAR(10) NULL;
END
