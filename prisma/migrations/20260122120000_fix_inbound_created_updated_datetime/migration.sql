-- Fix WP_INBOUND_STATUS created_at and updated_at: they were VARCHAR(100) with
-- DEFAULT 'getdate()' which stored the literal string 'getdate()' instead of actual dates.
-- Change to DATETIME with DEFAULT (getdate()) so they hold real timestamps.

-- 1) Drop existing default constraints (they apply to VARCHAR and store 'getdate()' as text)
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID('dbo.WP_INBOUND_STATUS') AND name = 'DF__WP_INBOUN__creat__49C3F6B7')
    ALTER TABLE [dbo].[WP_INBOUND_STATUS] DROP CONSTRAINT [DF__WP_INBOUN__creat__49C3F6B7];

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID('dbo.WP_INBOUND_STATUS') AND name = 'DF__WP_INBOUN__updat__4AB81AF0')
    ALTER TABLE [dbo].[WP_INBOUND_STATUS] DROP CONSTRAINT [DF__WP_INBOUN__updat__4AB81AF0];

-- 2) Replace literal 'getdate()' with a real datetime (use last_sync_date when parseable, else GETDATE())
UPDATE [dbo].[WP_INBOUND_STATUS]
SET [created_at] = CONVERT(VARCHAR(100), ISNULL(TRY_CAST([last_sync_date] AS datetime), GETDATE()), 120)
WHERE RTRIM(LTRIM([created_at])) = 'getdate()';

UPDATE [dbo].[WP_INBOUND_STATUS]
SET [updated_at] = CONVERT(VARCHAR(100), ISNULL(TRY_CAST([last_sync_date] AS datetime), GETDATE()), 120)
WHERE RTRIM(LTRIM([updated_at])) = 'getdate()';

-- 3) Alter columns to DATETIME NOT NULL (SQL Server will convert existing varchar date strings)
ALTER TABLE [dbo].[WP_INBOUND_STATUS] ALTER COLUMN [created_at] DATETIME NOT NULL;
ALTER TABLE [dbo].[WP_INBOUND_STATUS] ALTER COLUMN [updated_at] DATETIME NOT NULL;

-- 4) Add new defaults so new rows get the current timestamp
ALTER TABLE [dbo].[WP_INBOUND_STATUS] ADD CONSTRAINT [DF_WP_INBOUND_created_at] DEFAULT (getdate()) FOR [created_at];
ALTER TABLE [dbo].[WP_INBOUND_STATUS] ADD CONSTRAINT [DF_WP_INBOUND_updated_at] DEFAULT (getdate()) FOR [updated_at];
