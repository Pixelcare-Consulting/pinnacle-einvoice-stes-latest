const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

function extractCertificateInfo() {
  try {
    // Read the P12 file as a Buffer
    const p12Buffer = fs.readFileSync(path.join(__dirname, 'certificates/digital_certificate.p12'));
    
    // Convert Buffer to binary string properly
    const p12Binary = Buffer.from(p12Buffer).toString('binary');
    const p12Asn1 = forge.asn1.fromDer(p12Binary);
    
    const password = 'P!xel@2024';
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
    
    // Extract the certificate
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
    if (!certBags || !certBags[0]) {
      throw new Error('Certificate not found in P12 file');
    }
    
    const cert = certBags[0].cert;

    // Format certificate value (base64)
    const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert));
    const X509Certificate_VALUE = Buffer.from(certDer.getBytes(), 'binary').toString('base64');

    // Format subject name
    const subjectParts = [];
    cert.subject.attributes.forEach(attr => {
      if (attr.shortName === 'SERIALNUMBER') {
        subjectParts.push(`SERIALNUMBER=${attr.value}`);
      } else if (attr.type === '2.5.4.97') {
        subjectParts.push(`OID.2.5.4.97=${attr.value}`);
      } else if (attr.shortName) {
        subjectParts.push(`${attr.shortName}=${attr.value}`);
      }
    });
    const X509SubjectName_VALUE = subjectParts.join(', ');

    // Format issuer name
    const issuerParts = [];
    cert.issuer.attributes.forEach(attr => {
      if (attr.shortName) {
        issuerParts.push(`${attr.shortName}=${attr.value}`);
      }
    });
    const X509IssuerName_VALUE = issuerParts.join(', ');

    // Get serial number
    const X509SerialNumber_VALUE = cert.serialNumber;

    // Format output exactly like the example
    console.log('#v1.1 MANDATORY NEEDS!');
    console.log(`X509Certificate_VALUE='${X509Certificate_VALUE}'`);
    console.log(`X509SubjectName_VALUE='${X509SubjectName_VALUE}'`);
    console.log(`X509IssuerName_VALUE='${X509IssuerName_VALUE}'`);
    console.log(`X509SerialNumber_VALUE=${X509SerialNumber_VALUE}`);

    return {
      X509Certificate_VALUE,
      X509SubjectName_VALUE,
      X509IssuerName_VALUE,
      X509SerialNumber_VALUE
    };

  } catch (error) {
    console.error('Error extracting certificate info:', error);
    throw error;
  }
}

// Run the extraction
extractCertificateInfo();

module.exports = { extractCertificateInfo };