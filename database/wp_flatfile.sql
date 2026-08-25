-- WP_FLATFILE staging table for consolidated flat file uploads
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'WP_FLATFILE')
BEGIN
    CREATE TABLE WP_FLATFILE (
        id INT IDENTITY(1,1) PRIMARY KEY,
        supplier_name VARCHAR(255) NOT NULL,
        supplier_tin VARCHAR(50) NOT NULL,
        supplier_brn VARCHAR(50),
        supplier_msic VARCHAR(20),
        supplier_sst VARCHAR(50),
        buyer_name VARCHAR(255) NOT NULL,
        buyer_tin VARCHAR(50) NOT NULL,
        buyer_brn VARCHAR(50),
        buyer_sst VARCHAR(50),
        invoice_no VARCHAR(50) NOT NULL,
        invoice_date DATE NOT NULL,
        currency_code VARCHAR(3) DEFAULT 'MYR',
        exchange_rate DECIMAL(10, 4) DEFAULT 1.0000,
        item_description TEXT,
        classification VARCHAR(10),
        tax_type VARCHAR(10),
        tax_rate DECIMAL(5, 2),
        tax_amount DECIMAL(15, 2),
        total_excl_tax DECIMAL(15, 2) NOT NULL,
        total_incl_tax DECIMAL(15, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'Pending',
        is_mapped BIT DEFAULT 0,
        mapping_details NVARCHAR(MAX),
        upload_date DATETIME DEFAULT GETDATE(),
        processed_date DATETIME NULL,
        processed_by VARCHAR(50),
        submission_id VARCHAR(50),
        lhdn_response NVARCHAR(MAX),
        uuid VARCHAR(36) UNIQUE
    );
    
    -- Adding indexes
    CREATE INDEX idx_status ON WP_FLATFILE(status);
    CREATE INDEX idx_is_mapped ON WP_FLATFILE(is_mapped);
    CREATE INDEX idx_invoice_no ON WP_FLATFILE(invoice_no);
    CREATE INDEX idx_supplier_tin ON WP_FLATFILE(supplier_tin);
    CREATE INDEX idx_buyer_tin ON WP_FLATFILE(buyer_tin);
    CREATE INDEX idx_invoice_date ON WP_FLATFILE(invoice_date);
    CREATE INDEX idx_upload_date ON WP_FLATFILE(upload_date);
END