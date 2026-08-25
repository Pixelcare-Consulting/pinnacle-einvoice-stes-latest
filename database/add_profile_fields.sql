-- Add new columns to WP_USER_REGISTRATION table if they don't exist
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[WP_USER_REGISTRATION]') AND name = 'Phone')
BEGIN
    ALTER TABLE WP_USER_REGISTRATION ADD Phone VARCHAR(50) NULL;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[WP_USER_REGISTRATION]') AND name = 'ValidStatus')
BEGIN
    ALTER TABLE WP_USER_REGISTRATION ADD ValidStatus CHAR(1) DEFAULT '1' NULL;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[WP_USER_REGISTRATION]') AND name = 'LastLoginTime')
BEGIN
    ALTER TABLE WP_USER_REGISTRATION ADD LastLoginTime DATETIME NULL;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[WP_USER_REGISTRATION]') AND name = 'ProfilePicture')
BEGIN
    ALTER TABLE WP_USER_REGISTRATION ADD ProfilePicture VARCHAR(255) NULL;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[WP_USER_REGISTRATION]') AND name = 'TwoFactorEnabled')
BEGIN
    ALTER TABLE WP_USER_REGISTRATION ADD TwoFactorEnabled BIT DEFAULT 0 NULL;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[WP_USER_REGISTRATION]') AND name = 'NotificationsEnabled')
BEGIN
    ALTER TABLE WP_USER_REGISTRATION ADD NotificationsEnabled BIT DEFAULT 0 NULL;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[WP_USER_REGISTRATION]') AND name = 'UpdateTS')
BEGIN
    ALTER TABLE WP_USER_REGISTRATION ADD UpdateTS DATETIME NULL;
END

-- Add extended properties for documentation
EXEC sys.sp_addextendedproperty @name = N'MS_Description', 
    @value = N'User phone number',
    @level0type = N'SCHEMA', @level0name = 'dbo',
    @level1type = N'TABLE',  @level1name = 'WP_USER_REGISTRATION',
    @level2type = N'COLUMN', @level2name = 'Phone';

EXEC sys.sp_addextendedproperty @name = N'MS_Description',
    @value = N'Account status (1=active, 0=inactive)',
    @level0type = N'SCHEMA', @level0name = 'dbo',
    @level1type = N'TABLE',  @level1name = 'WP_USER_REGISTRATION',
    @level2type = N'COLUMN', @level2name = 'ValidStatus';

EXEC sys.sp_addextendedproperty @name = N'MS_Description',
    @value = N'Last successful login timestamp',
    @level0type = N'SCHEMA', @level0name = 'dbo',
    @level1type = N'TABLE',  @level1name = 'WP_USER_REGISTRATION',
    @level2type = N'COLUMN', @level2name = 'LastLoginTime';

EXEC sys.sp_addextendedproperty @name = N'MS_Description',
    @value = N'Path to user profile picture',
    @level0type = N'SCHEMA', @level0name = 'dbo',
    @level1type = N'TABLE',  @level1name = 'WP_USER_REGISTRATION',
    @level2type = N'COLUMN', @level2name = 'ProfilePicture';

EXEC sys.sp_addextendedproperty @name = N'MS_Description',
    @value = N'Two-factor authentication enabled flag',
    @level0type = N'SCHEMA', @level0name = 'dbo',
    @level1type = N'TABLE',  @level1name = 'WP_USER_REGISTRATION',
    @level2type = N'COLUMN', @level2name = 'TwoFactorEnabled';

EXEC sys.sp_addextendedproperty @name = N'MS_Description',
    @value = N'Login notifications enabled flag',
    @level0type = N'SCHEMA', @level0name = 'dbo',
    @level1type = N'TABLE',  @level1name = 'WP_USER_REGISTRATION',
    @level2type = N'COLUMN', @level2name = 'NotificationsEnabled';

EXEC sys.sp_addextendedproperty @name = N'MS_Description',
    @value = N'Last profile update timestamp',
    @level0type = N'SCHEMA', @level0name = 'dbo',
    @level1type = N'TABLE',  @level1name = 'WP_USER_REGISTRATION',
    @level2type = N'COLUMN', @level2name = 'UpdateTS'; 