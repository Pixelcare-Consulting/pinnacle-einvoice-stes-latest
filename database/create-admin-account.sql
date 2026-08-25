-- Create Admin Account Script for Fresh Database
-- This script creates a default admin account for initial system access

SET NOCOUNT ON;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @AdminUsername VARCHAR(255) = 'admin';
    DECLARE @AdminEmail VARCHAR(255) = 'admin@einvoice.com';
    DECLARE @AdminFullName VARCHAR(255) = 'System Administrator';
    -- Default password: Admin@123 (should be changed upon first login)
    DECLARE @AdminPassword VARCHAR(255) = '$2a$10$8K1p/a0dL1LXMIZoIqQK6.X5Q8wGGtcw/P7IWVD6j8MHUVp9JxfC2';
    DECLARE @CurrentDateTime DATETIME = GETDATE();

    -- Check if admin account already exists
    IF NOT EXISTS (SELECT 1 FROM WP_USER_REGISTRATION WHERE Username = @AdminUsername OR Email = @AdminEmail)
    BEGIN
        -- Create admin user
        INSERT INTO WP_USER_REGISTRATION (
            Username,
            Email,
            FullName,
            Password,
            UserType,
            Admin,
            ValidStatus,
            CreateTS,
            UpdateTS,
            TwoFactorEnabled,
            NotificationsEnabled
        )
        VALUES (
            @AdminUsername,
            @AdminEmail,
            @AdminFullName,
            @AdminPassword,
            'Internal',
            1, -- Admin flag
            '1', -- Valid status
            @CurrentDateTime,
            @CurrentDateTime,
            0, -- Two factor disabled by default
            1  -- Notifications enabled by default
        );

        DECLARE @AdminId INT = SCOPE_IDENTITY();

        -- Log admin creation
        INSERT INTO WP_LOGS (
            Description,
            CreateTS,
            LoggedUser,
            IPAddress,
            LogType,
            Module,
            Action,
            Status,
            UserID
        )
        VALUES (
            'Default admin account created during system initialization',
            @CurrentDateTime,
            'SYSTEM',
            '127.0.0.1',
            'SETUP',
            'ADMIN',
            'CREATE',
            'SUCCESS',
            @AdminId
        );

        PRINT 'Admin account created successfully.';
        PRINT 'Username: ' + @AdminUsername;
        PRINT 'Password: Admin@123';
        PRINT 'IMPORTANT: Please change the password upon first login!';
    END
    ELSE
    BEGIN
        PRINT 'Admin account already exists. Skipping creation.';
    END

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;

    PRINT 'Error creating admin account:';
    PRINT ERROR_MESSAGE();
    
    -- Log the error
    INSERT INTO WP_LOGS (
        Description,
        CreateTS,
        LoggedUser,
        IPAddress,
        LogType,
        Module,
        Action,
        Status
    )
    VALUES (
        'Error creating default admin account: ' + ERROR_MESSAGE(),
        GETDATE(),
        'SYSTEM',
        '127.0.0.1',
        'SETUP',
        'ADMIN',
        'CREATE',
        'ERROR'
    );

    THROW;
END CATCH;
GO 