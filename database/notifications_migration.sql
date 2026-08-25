-- Notifications System Migration Script
-- Run this script to add the new notification and announcement tables

-- Create WP_NOTIFICATIONS table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'WP_NOTIFICATIONS')
BEGIN
    CREATE TABLE WP_NOTIFICATIONS (
        id INT IDENTITY(1,1) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'system', -- 'system', 'lhdn', 'announcement', 'alert'
        priority VARCHAR(20) NOT NULL DEFAULT 'normal', -- 'low', 'normal', 'high', 'urgent'
        target_user_id INT NULL, -- null for all users, specific ID for targeted notifications
        target_role VARCHAR(50) NULL, -- 'admin', 'user', null for all
        is_read BIT NOT NULL DEFAULT 0,
        is_global BIT NOT NULL DEFAULT 0, -- true for announcements visible to all
        source_type VARCHAR(50) NULL, -- 'internal', 'lhdn_api', 'system'
        source_id VARCHAR(255) NULL, -- reference to source record
        metadata TEXT NULL, -- JSON metadata
        expires_at DATETIME NULL,
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE()
    );

    -- Create indexes for better performance
    CREATE INDEX idx_notifications_user ON WP_NOTIFICATIONS(target_user_id);
    CREATE INDEX idx_notifications_type ON WP_NOTIFICATIONS(type);
    CREATE INDEX idx_notifications_read ON WP_NOTIFICATIONS(is_read);
    CREATE INDEX idx_notifications_created ON WP_NOTIFICATIONS(created_at);
    CREATE INDEX idx_notifications_expires ON WP_NOTIFICATIONS(expires_at);

    PRINT 'WP_NOTIFICATIONS table created successfully';
END
ELSE
BEGIN
    PRINT 'WP_NOTIFICATIONS table already exists';
END

-- Create WP_ANNOUNCEMENTS table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'WP_ANNOUNCEMENTS')
BEGIN
    CREATE TABLE WP_ANNOUNCEMENTS (
        id INT IDENTITY(1,1) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        summary VARCHAR(500) NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'general', -- 'general', 'maintenance', 'feature', 'security'
        priority VARCHAR(20) NOT NULL DEFAULT 'normal', -- 'low', 'normal', 'high', 'urgent'
        status VARCHAR(20) NOT NULL DEFAULT 'draft', -- 'draft', 'published', 'archived'
        target_audience VARCHAR(50) NOT NULL DEFAULT 'all', -- 'all', 'admin', 'users'
        is_pinned BIT NOT NULL DEFAULT 0,
        is_popup BIT NOT NULL DEFAULT 0, -- show as popup on login
        publish_at DATETIME NULL,
        expires_at DATETIME NULL,
        created_by INT NOT NULL,
        updated_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE()
    );

    -- Create indexes for better performance
    CREATE INDEX idx_announcements_status ON WP_ANNOUNCEMENTS(status);
    CREATE INDEX idx_announcements_type ON WP_ANNOUNCEMENTS(type);
    CREATE INDEX idx_announcements_publish ON WP_ANNOUNCEMENTS(publish_at);
    CREATE INDEX idx_announcements_created ON WP_ANNOUNCEMENTS(created_at);

    PRINT 'WP_ANNOUNCEMENTS table created successfully';
END
ELSE
BEGIN
    PRINT 'WP_ANNOUNCEMENTS table already exists';
END

-- Create WP_USER_NOTIFICATION_SETTINGS table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'WP_USER_NOTIFICATION_SETTINGS')
BEGIN
    CREATE TABLE WP_USER_NOTIFICATION_SETTINGS (
        id INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        email_notifications BIT NOT NULL DEFAULT 1,
        browser_notifications BIT NOT NULL DEFAULT 1,
        system_alerts BIT NOT NULL DEFAULT 1,
        lhdn_notifications BIT NOT NULL DEFAULT 1,
        announcement_popup BIT NOT NULL DEFAULT 1,
        digest_frequency VARCHAR(20) NOT NULL DEFAULT 'daily', -- 'none', 'daily', 'weekly'
        quiet_hours_start VARCHAR(5) NULL, -- HH:MM format
        quiet_hours_end VARCHAR(5) NULL, -- HH:MM format
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE()
    );

    -- Create index for better performance
    CREATE INDEX idx_user_notification_settings_user ON WP_USER_NOTIFICATION_SETTINGS(user_id);

    PRINT 'WP_USER_NOTIFICATION_SETTINGS table created successfully';
END
ELSE
BEGIN
    PRINT 'WP_USER_NOTIFICATION_SETTINGS table already exists';
END

-- Insert sample announcements for testing
IF NOT EXISTS (SELECT * FROM WP_ANNOUNCEMENTS WHERE title = 'Welcome to the Enhanced eInvoice Portal')
BEGIN
    INSERT INTO WP_ANNOUNCEMENTS (
        title, 
        content, 
        summary, 
        type, 
        priority, 
        status, 
        target_audience, 
        is_pinned, 
        is_popup, 
        created_by
    ) VALUES (
        'Welcome to the Enhanced eInvoice Portal',
        '<h3>Welcome to the Enhanced eInvoice Portal</h3><p>We are excited to introduce our new notification system and enhanced features:</p><ul><li><strong>Real-time Notifications</strong> - Stay updated with system alerts and LHDN notifications</li><li><strong>Improved Dashboard</strong> - Better overview of your eInvoice activities</li><li><strong>Enhanced Security</strong> - Additional security measures for your data protection</li></ul><p>For any questions or support, please contact our technical team.</p>',
        'Welcome to the enhanced eInvoice portal with new notification system and improved features.',
        'feature',
        'normal',
        'published',
        'all',
        1,
        1,
        1
    );

    PRINT 'Sample announcement inserted successfully';
END

-- Insert sample system notification
IF NOT EXISTS (SELECT * FROM WP_NOTIFICATIONS WHERE title = 'System Upgrade Complete')
BEGIN
    INSERT INTO WP_NOTIFICATIONS (
        title,
        message,
        type,
        priority,
        is_global,
        source_type,
        created_by
    ) VALUES (
        'System Upgrade Complete',
        'The eInvoice portal has been successfully upgraded with new notification features and enhanced security measures. All systems are now operational.',
        'system',
        'normal',
        1,
        'system',
        1
    );

    PRINT 'Sample system notification inserted successfully';
END

-- Create default notification settings for existing users
INSERT INTO WP_USER_NOTIFICATION_SETTINGS (user_id)
SELECT ID FROM WP_USER_REGISTRATION 
WHERE ID NOT IN (SELECT user_id FROM WP_USER_NOTIFICATION_SETTINGS);

PRINT 'Default notification settings created for existing users';

-- Update WP_LOGS table to add a Details column if it doesn't exist
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_LOGS') AND name = 'Details')
BEGIN
    ALTER TABLE WP_LOGS ADD Details TEXT NULL;
    PRINT 'Details column added to WP_LOGS table';
END

PRINT 'Notifications system migration completed successfully!';
PRINT '';
PRINT 'Next steps:';
PRINT '1. Run: pnpm prisma generate';
PRINT '2. Restart your application';
PRINT '3. Access notifications at: /dashboard/notifications';
PRINT '4. Access developer settings at: /dashboard/developer-settings (admin only)';
