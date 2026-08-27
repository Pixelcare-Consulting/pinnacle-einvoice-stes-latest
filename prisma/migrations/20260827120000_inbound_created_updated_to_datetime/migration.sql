-- Convert WP_INBOUND_STATUS.created_at / updated_at to DATETIME (idempotent).
-- Live columns may still be VARCHAR/NVARCHAR or DATETIME2(7), which Prisma DateTime
-- cannot parse (e.g. "2026-06-18 00:05:45.7260000"). Do not rely on generated
-- default constraint names.

-- 1) Drop whatever default constraints exist on created_at / updated_at
DECLARE @dropDefaultsSql NVARCHAR(MAX) = N'';

SELECT @dropDefaultsSql = @dropDefaultsSql
    + N'ALTER TABLE [dbo].[WP_INBOUND_STATUS] DROP CONSTRAINT [' + dc.name + N'];'
FROM sys.default_constraints dc
INNER JOIN sys.columns c
    ON c.object_id = dc.parent_object_id
   AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id = OBJECT_ID(N'dbo.WP_INBOUND_STATUS')
  AND c.name IN (N'created_at', N'updated_at');

IF LEN(@dropDefaultsSql) > 0
    EXEC sp_executesql @dropDefaultsSql;

-- 2) Sanitize VARCHAR/NVARCHAR values that cannot become DATETIME
IF EXISTS (
    SELECT 1
    FROM sys.columns c
    INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.WP_INBOUND_STATUS')
      AND c.name = N'created_at'
      AND t.name IN (N'varchar', N'nvarchar', N'char', N'nchar')
)
BEGIN
    UPDATE [dbo].[WP_INBOUND_STATUS]
    SET [created_at] = CONVERT(VARCHAR(23), COALESCE(
            TRY_CONVERT(datetime, NULLIF(RTRIM(LTRIM([created_at])), N'')),
            TRY_CONVERT(datetime2, NULLIF(RTRIM(LTRIM([created_at])), N'')),
            TRY_CONVERT(datetime, [last_sync_date]),
            TRY_CONVERT(datetime2, [last_sync_date]),
            GETDATE()
        ), 121);
END;

IF EXISTS (
    SELECT 1
    FROM sys.columns c
    INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.WP_INBOUND_STATUS')
      AND c.name = N'updated_at'
      AND t.name IN (N'varchar', N'nvarchar', N'char', N'nchar')
)
BEGIN
    UPDATE [dbo].[WP_INBOUND_STATUS]
    SET [updated_at] = CONVERT(VARCHAR(23), COALESCE(
            TRY_CONVERT(datetime, NULLIF(RTRIM(LTRIM([updated_at])), N'')),
            TRY_CONVERT(datetime2, NULLIF(RTRIM(LTRIM([updated_at])), N'')),
            TRY_CONVERT(datetime, [last_sync_date]),
            TRY_CONVERT(datetime2, [last_sync_date]),
            GETDATE()
        ), 121);
END;

-- Fill NULLs on existing datetime / datetime2 columns so ALTER ... NOT NULL can succeed
IF EXISTS (
    SELECT 1
    FROM sys.columns c
    INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.WP_INBOUND_STATUS')
      AND c.name = N'created_at'
      AND t.name IN (N'datetime', N'datetime2', N'smalldatetime', N'date')
)
BEGIN
    UPDATE [dbo].[WP_INBOUND_STATUS]
    SET [created_at] = COALESCE(
            [created_at],
            TRY_CONVERT(datetime, [last_sync_date]),
            GETDATE()
        )
    WHERE [created_at] IS NULL;
END;

IF EXISTS (
    SELECT 1
    FROM sys.columns c
    INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.WP_INBOUND_STATUS')
      AND c.name = N'updated_at'
      AND t.name IN (N'datetime', N'datetime2', N'smalldatetime', N'date')
)
BEGIN
    UPDATE [dbo].[WP_INBOUND_STATUS]
    SET [updated_at] = COALESCE(
            [updated_at],
            TRY_CONVERT(datetime, [last_sync_date]),
            GETDATE()
        )
    WHERE [updated_at] IS NULL;
END;

-- 3) ALTER to DATETIME NOT NULL when the native type is not already DATETIME
IF EXISTS (
    SELECT 1
    FROM sys.columns c
    INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.WP_INBOUND_STATUS')
      AND c.name = N'created_at'
      AND (t.name <> N'datetime' OR c.is_nullable = 1)
)
BEGIN
    ALTER TABLE [dbo].[WP_INBOUND_STATUS] ALTER COLUMN [created_at] DATETIME NOT NULL;
END;

IF EXISTS (
    SELECT 1
    FROM sys.columns c
    INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.WP_INBOUND_STATUS')
      AND c.name = N'updated_at'
      AND (t.name <> N'datetime' OR c.is_nullable = 1)
)
BEGIN
    ALTER TABLE [dbo].[WP_INBOUND_STATUS] ALTER COLUMN [updated_at] DATETIME NOT NULL;
END;

-- 4) Re-add DEFAULT (getdate()) if missing
IF NOT EXISTS (
    SELECT 1
    FROM sys.default_constraints dc
    INNER JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID(N'dbo.WP_INBOUND_STATUS')
      AND c.name = N'created_at'
)
BEGIN
    ALTER TABLE [dbo].[WP_INBOUND_STATUS]
        ADD CONSTRAINT [DF_WP_INBOUND_created_at] DEFAULT (getdate()) FOR [created_at];
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.default_constraints dc
    INNER JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID(N'dbo.WP_INBOUND_STATUS')
      AND c.name = N'updated_at'
)
BEGIN
    ALTER TABLE [dbo].[WP_INBOUND_STATUS]
        ADD CONSTRAINT [DF_WP_INBOUND_updated_at] DEFAULT (getdate()) FOR [updated_at];
END;
