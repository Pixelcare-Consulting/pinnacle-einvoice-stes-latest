-- Update WP_FLATFILE table with additional fields required for LHDN MyInvois consolidated invoices

-- Add supplier address fields
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'supplier_address')
BEGIN
    ALTER TABLE WP_FLATFILE ADD supplier_address VARCHAR(255);
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'supplier_city')
BEGIN
    ALTER TABLE WP_FLATFILE ADD supplier_city VARCHAR(100);
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'supplier_state')
BEGIN
    ALTER TABLE WP_FLATFILE ADD supplier_state VARCHAR(50);
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'supplier_country')
BEGIN
    ALTER TABLE WP_FLATFILE ADD supplier_country VARCHAR(3) DEFAULT 'MYS';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'supplier_contact')
BEGIN
    ALTER TABLE WP_FLATFILE ADD supplier_contact VARCHAR(20);
END

-- Add buyer address fields
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'buyer_address')
BEGIN
    ALTER TABLE WP_FLATFILE ADD buyer_address VARCHAR(255);
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'buyer_city')
BEGIN
    ALTER TABLE WP_FLATFILE ADD buyer_city VARCHAR(100);
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'buyer_state')
BEGIN
    ALTER TABLE WP_FLATFILE ADD buyer_state VARCHAR(50);
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'buyer_country')
BEGIN
    ALTER TABLE WP_FLATFILE ADD buyer_country VARCHAR(3) DEFAULT 'MYS';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'buyer_contact')
BEGIN
    ALTER TABLE WP_FLATFILE ADD buyer_contact VARCHAR(20);
END

-- Add invoice time field
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'invoice_time')
BEGIN
    ALTER TABLE WP_FLATFILE ADD invoice_time TIME;
END

-- Add e-Invoice version and type fields
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'einvoice_version')
BEGIN
    ALTER TABLE WP_FLATFILE ADD einvoice_version VARCHAR(5) DEFAULT '1.0';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'einvoice_type')
BEGIN
    ALTER TABLE WP_FLATFILE ADD einvoice_type VARCHAR(2) DEFAULT '01';
END

-- Rename columns for clarity
IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'supplier_ssm')
BEGIN
    EXEC sp_rename 'WP_FLATFILE.supplier_brn', 'supplier_brn', 'COLUMN';
END

IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('WP_FLATFILE') AND name = 'buyer_ssm')
BEGIN
    EXEC sp_rename 'WP_FLATFILE.buyer_brn', 'buyer_brn', 'COLUMN';
END

-- Add indexes for new fields
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_einvoice_type' AND object_id = OBJECT_ID('WP_FLATFILE'))
BEGIN
    CREATE INDEX idx_einvoice_type ON WP_FLATFILE(einvoice_type);
END

PRINT 'WP_FLATFILE table updated successfully with all required fields for LHDN MyInvois consolidated invoices.' 