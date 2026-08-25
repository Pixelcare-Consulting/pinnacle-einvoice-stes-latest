--CREATE DATABASE PXC_EELIAN_PROD_DATABASE

-- WP_USER_REGISTRATION
CREATE TABLE WP_USER_REGISTRATION (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    FullName VARCHAR(255) NULL,
    Email VARCHAR(255) UNIQUE,
    Username VARCHAR(255) UNIQUE,
    Password VARCHAR(255) NULL,
    UserType VARCHAR(255) NULL,
    TIN VARCHAR(255) NULL,
    IDType VARCHAR(255) NULL,
    IDValue VARCHAR(255) NULL,
    ClientID VARCHAR(255) NULL,
    ClientSecret VARCHAR(255) NULL,
    DigitalSignaturePath VARCHAR(255) NULL,
    DigitalSignatureFileName VARCHAR(255) NULL,
    Admin INT NULL,
    CreateTS DATETIME NULL,
    Phone VARCHAR(50) NULL,
    ValidStatus CHAR(1) DEFAULT '1',
    LastLoginTime DATETIME NULL,
    ProfilePicture VARCHAR(255) NULL,
    TwoFactorEnabled BIT DEFAULT 0,
    NotificationsEnabled BIT DEFAULT 0,
    UpdateTS DATETIME NULL
);

-- WP_COMPANY_SETTINGS
CREATE TABLE WP_COMPANY_SETTINGS (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    CompanyImage VARCHAR(255) NULL,
    CompanyName VARCHAR(255) NULL,
    Industry VARCHAR(255) NULL,
    Country VARCHAR(255) NULL,
    TIN VARCHAR(255) NULL,
    BRN VARCHAR(255) NULL,
    About TEXT NULL,
    Address VARCHAR(255) NULL,
    Phone VARCHAR(255) NULL,
    Email VARCHAR(255) NULL,
    ValidStatus VARCHAR(255) NULL,
    UserID VARCHAR(255) NULL
);

-- WP_CONFIGURATION
CREATE TABLE WP_CONFIGURATION (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    Type VARCHAR(50) NOT NULL,
    UserID VARCHAR(255) NOT NULL,
    Settings NVARCHAR(MAX) NOT NULL,
    IsActive BIT DEFAULT 1,
    CreateTS DATETIME NOT NULL,
    UpdateTS DATETIME NOT NULL
);


-- Drop existing table if it exists
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[WP_INBOUND_STATUS]') AND type in (N'U'))
BEGIN
    DROP TABLE [dbo].[WP_INBOUND_STATUS]
END
GO

-- Create the table with updated schema
CREATE TABLE [dbo].[WP_INBOUND_STATUS] (
    [uuid] VARCHAR(100) PRIMARY KEY,
    [submissionUid] VARCHAR(100) NULL,
    [longId] VARCHAR(100) NULL,
    [internalId] VARCHAR(50) NULL,
    [typeName] VARCHAR(50) NULL,
    [typeVersionName] VARCHAR(50) NULL,
    [issuerTin] VARCHAR(50) NULL,
    [issuerName] VARCHAR(255) NULL,
    [receiverId] VARCHAR(50) NULL,
    [receiverName] VARCHAR(255) NULL,
    [dateTimeReceived] VARCHAR(100) NULL,
    [dateTimeValidated] VARCHAR(100) NULL,
    [status] VARCHAR(50) NULL,
    [documentStatusReason] VARCHAR(500) NULL,
    [cancelDateTime] VARCHAR(100) NULL,
    [rejectRequestDateTime] VARCHAR(100) NULL,
    [createdByUserId] VARCHAR(100) NULL,
    [dateTimeIssued] VARCHAR(100) NULL,
    [totalSales] DECIMAL(18,2) NULL,
    [totalExcludingTax] DECIMAL(18,2) NULL,
    [totalDiscount] DECIMAL(18,2) NULL,
    [totalNetAmount] DECIMAL(18,2) NULL,
    [totalPayableAmount] DECIMAL(18,2) NULL,
    [last_sync_date] VARCHAR(100) NULL,
    [sync_status] VARCHAR(50) NULL,
	[documentDetails] TEXT NULL,
    [created_at] VARCHAR(100) NOT NULL DEFAULT GETDATE(),
    [updated_at] VARCHAR(100) NOT NULL DEFAULT GETDATE()
);


-- Create indexes for better performance
CREATE INDEX [IX_WP_INBOUND_STATUS_dateTimeReceived] ON [dbo].[WP_INBOUND_STATUS]([dateTimeReceived] DESC);
CREATE INDEX [IX_WP_INBOUND_STATUS_status] ON [dbo].[WP_INBOUND_STATUS]([status]);
CREATE INDEX [IX_WP_INBOUND_STATUS_issuerTin] ON [dbo].[WP_INBOUND_STATUS]([issuerTin]);
CREATE INDEX [IX_WP_INBOUND_STATUS_last_sync_date] ON [dbo].[WP_INBOUND_STATUS]([last_sync_date]);
GO

-- WP_LOGS
CREATE TABLE WP_LOGS (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    Description VARCHAR(255) NULL,
    CreateTS DATETIME NULL,
    LoggedUser VARCHAR(255) NULL,
    IPAddress VARCHAR(255) NULL,
    LogType VARCHAR(255) NULL,
    Module VARCHAR(255) NULL,
    Action VARCHAR(255) NULL,
    Status VARCHAR(255) NULL,
    UserID INT NULL
);

-- WP_SFTP_CONFIG
CREATE TABLE WP_SFTP_CONFIG (
    id INT IDENTITY(1,1) PRIMARY KEY,
    host VARCHAR(255) NOT NULL,
    port VARCHAR(10) DEFAULT '22',
    username VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    root_path VARCHAR(255) DEFAULT '/eInvoiceFTP',
    incoming_manual_template VARCHAR(255) NULL,
    incoming_schedule_template VARCHAR(255) NULL,
    outgoing_manual_template VARCHAR(255) NULL,
    outgoing_schedule_template VARCHAR(255) NULL,
    is_active BIT DEFAULT 1,
    createdAt VARCHAR(50) NOT NULL DEFAULT FORMAT(GETDATE(), 'yyyy-MM-dd HH:mm:ss'),
    updatedAt VARCHAR(50) NOT NULL DEFAULT FORMAT(GETDATE(), 'yyyy-MM-dd HH:mm:ss'),
    CONSTRAINT UQ_SFTP_HOST_USERNAME UNIQUE (host, username)
);

-- WP_SUBMISSION_STATUS
CREATE TABLE WP_SUBMISSION_STATUS (
    DocNum VARCHAR(255) NOT NULL,
    UUID VARCHAR(255) NULL,
    SubmissionUID VARCHAR(255) NULL,
    SubmissionStatus VARCHAR(255) NULL,
    DateTimeSent DATETIME NULL,
    DateTimeUpdated DATETIME NULL,
    RejectionDetails TEXT NULL,
    FileName VARCHAR(255) NULL,
    CONSTRAINT PK_WP_SUBMISSION_STATUS PRIMARY KEY (DocNum),
    CONSTRAINT UQ_WP_SUBMISSION_STATUS_FILENAME UNIQUE (FileName)
);

-- Create new table with UUID
CREATE TABLE WP_OUTBOUND_STATUS (
    id INT IDENTITY(1,1) PRIMARY KEY,
    UUID VARCHAR(255) NULL,
    submissionUid VARCHAR(255) NOT NULL,
    company VARCHAR(255) NULL,
    supplier VARCHAR(255) NULL,
    receiver VARCHAR(255) NULL,
    fileName VARCHAR(255) NOT NULL,
    filePath VARCHAR(255) NOT NULL UNIQUE,
    invoice_number VARCHAR(255) NOT NULL,
    source VARCHAR(255) NULL,
    amount VARCHAR(255) NULL,
    document_type VARCHAR(255) NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    date_submitted DATETIME NULL,
    date_sync DATETIME NULL,
    date_cancelled DATETIME NULL,
    cancelled_by VARCHAR(255) NULL,
    cancellation_reason VARCHAR(MAX) NULL,
    created_at DATETIME NOT NULL DEFAULT GETDATE(),
    updated_at DATETIME NOT NULL DEFAULT GETDATE()
);

-- Create indexes for better performance
CREATE INDEX IX_WP_OUTBOUND_STATUS_UUID ON WP_OUTBOUND_STATUS(UUID);
CREATE INDEX IX_WP_OUTBOUND_STATUS_INVOICE_NUMBER ON WP_OUTBOUND_STATUS(invoice_number);
GO 