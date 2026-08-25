-- Create Session table for Prisma Session Store
CREATE TABLE [dbo].[Session] (
    [id] NVARCHAR(36) NOT NULL PRIMARY KEY,
    [sid] NVARCHAR(255) NOT NULL UNIQUE,
    [data] NVARCHAR(MAX) NOT NULL,
    [expires] DATETIME NOT NULL,
    [createdAt] DATETIME NOT NULL DEFAULT GETDATE(),
    [updatedAt] DATETIME NOT NULL DEFAULT GETDATE()
);

-- Create index on sid for faster lookups
CREATE INDEX [idx_session_sid] ON [dbo].[Session] ([sid]);

-- Create index on expires for cleanup operations
CREATE INDEX [idx_session_expires] ON [dbo].[Session] ([expires]);
