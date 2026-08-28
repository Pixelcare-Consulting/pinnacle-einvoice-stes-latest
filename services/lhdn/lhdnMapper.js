const fs = require('fs');
const path = require('path');
const { getCertificatesHashedParams } = require('./lhdnService');
const {
  clipIdByScheme,
  hasMeaningfulValue,
  INVOICE_ADR_TYPES,
  isEmptyOptional,
  isMeaningfulIndustry,
  isValidIncoterms,
  LhdnMappingError,
  PARTY_ID_SCHEMES,
  PRIMARY_ID_SCHEMES,
  resolveIndustryName,
  SDK_FIELD_LIMITS,
  toIsoDate,
  toPlainAmount,
  truncate,
  hasShipmentFreightCharge,
  resolveDeliveryShipmentId,
  shouldEmitDeliveryShipment
} = require('./sdkFieldLimits');

/**
 * Logger configuration for mapping process
 */
const createLogger = () => {
  const logs = {
    steps: [],
    mappings: [],
    errors: []
  };

  const logStep = (step, data) => {
    logs.steps.push({
      timestamp: new Date().toISOString(),
      step,
      data
    });
  };

  const logMapping = (section, input, output) => {
    logs.mappings.push({
      timestamp: new Date().toISOString(),
      section,
      input,
      output
    });
  };

  const logError = (error, context) => {
    logs.errors.push({
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack,
      context
    });
  };

  const writeLogs = (invoiceNo, lhdnFormat) => {
    try {
      const logsDir = path.join(process.cwd(), 'logs', 'lhdn');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      // Write processing logs
      const processLogFileName = `lhdn_process_${invoiceNo}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const processLogPath = path.join(logsDir, processLogFileName);
      fs.writeFileSync(processLogPath, JSON.stringify(logs, null, 2));
      console.log(`[INFO] LHDN Processing logs written to: ${processLogPath}`);

      // Write LHDN format JSON
      const lhdnFileName = `lhdn_output_${invoiceNo}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const lhdnPath = path.join(logsDir, lhdnFileName);
      fs.writeFileSync(lhdnPath, JSON.stringify(lhdnFormat, null, 2));
      console.log(`[INFO] LHDN Output JSON written to: ${lhdnPath}`);
    } catch (error) {
      console.error('[ERROR] Failed to write LHDN logs:', error);
    }
  };

  return {
    logStep,
    logMapping,
    logError,
    writeLogs,
    getLogs: () => logs
  };
};

// Helper functions
const convertToBoolean = (value) => {
  if (value === true || value === 'true' || value === 1) return true;
  if (value === false || value === 'false' || value === 0) return false;
  return false; // default to false if undefined/null
};

const wrapValue = (value, currencyID = null) => {
  if (currencyID) {
    const amount = toPlainAmount(value);
    if (amount === undefined) {
      return undefined;
    }
    return [{
      "_": amount,
      "currencyID": currencyID
    }];
  }

  if (isEmptyOptional(value)) {
    return undefined;
  }

  return [{
    "_": String(value).trim()
  }];
};

const wrapDate = (value) => {
  const isoDate = toIsoDate(value);
  if (!isoDate) {
    return undefined;
  }
  return [{ "_": isoDate }];
};

const wrapBoolean = (value) => {
  return [{
    "_": convertToBoolean(value)
  }];
};

const wrapNumericValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const numValue = Number(value);
  return isNaN(numValue) ? undefined : [{
    "_": numValue
  }];
};

const formatDateTime = (date) => {
  if (!date) return undefined;

  // If date is already a string in correct format, return it
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(date)) {
    return date;
  }

  try {
    // Convert to Date object if it isn't already
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return undefined;
    }
    // Format as ISO string and remove milliseconds and timezone
    return dateObj.toISOString().split('.')[0];
  } catch (error) {
    console.error('Error formatting date:', error);
    return undefined;
  }
};

const mapAddressLines = (line) => {
  if (!line) return undefined;

  // Convert to string and handle special cases
  const addressStr = String(line);
  if (addressStr.toLowerCase() === 'na' || addressStr.trim() === '') {
    return [{
      "Line": [{ "_": "NA" }]
    }];
  }

  // Split the address line by commas or line breaks
  let lines = addressStr.split(/[,\n]/).map(l => l.trim()).filter(l => l);

  // If there are no commas, try to intelligently split the address
  if (lines.length === 1) {
    // Common address patterns for various address types
    const commonAddressPatterns = /\s+(?=\d+[A-Za-z]|\d+,|Jalan|Taman|Persiaran|Lorong|Kampung|Kg\.|Bandar|Street|Road|Lane|Avenue|Block|Unit|Floor|Level|Plaza|Tower|Building|Complex|Park|Garden|Heights|Court|Apartment|Suite|Room|House|No\.|No\s+\d+)/i;

    if (addressStr.match(commonAddressPatterns)) {
      const parts = addressStr.split(commonAddressPatterns);
      lines = parts.map(p => p.trim()).filter(p => p);
    }
  }

  // Ensure we don't have duplicate country codes in address lines
  lines = lines.filter(line =>
    !line.match(/^(MYS|Malaysia|SGP|Singapore)$/i) ||
    lines.indexOf(line) === lines.findIndex(l => l.match(/^(MYS|Malaysia|SGP|Singapore)$/i))
  );

  // Remove any duplicate address lines
  const uniqueLines = [...new Set(lines)];

  // Format address lines properly
  const formattedLines = uniqueLines.map(line => {
    // If this is a line that should end with a comma but doesn't, add one
    // This applies to address prefixes like PLO, No., Block, etc.
    if (line.match(/^(PLO|No\.|Block|Unit|Floor|Level)\s+\d+$/i)) {
      return line + ',';
    }
    return line;
  });

  return formattedLines.map(l => ({
    "Line": [{ "_": l }]
  }));
};

const mapAllowanceCharges = (charges) => {
  if (!charges || !Array.isArray(charges)) {
    charges = [charges];
  }

  return charges.map(charge => ({
    "ChargeIndicator": wrapBoolean(charge.indicator),
    "AllowanceChargeReason": wrapValue(charge.reason || 'NA'),
    "MultiplierFactorNumeric": charge.multiplierFactorNumeric ? [{
      "_": charge.multiplierFactorNumeric
    }] : undefined,
    "Amount": wrapValue(charge.amount || 0, 'MYR')
  })).filter(c => c);
};

const mapCommodityClassifications = (item) => {
  const classifications = [];

  if (item.ptcCode) {
    classifications.push({
      "ItemClassificationCode": [{
        "_": item.ptcCode,
        "listID": "PTC"
      }]
    });
  }

  if (item.classification?.code) {
    if (item.classification.code === '004') {
      classifications.push({
        "ItemClassificationCode": [{
          "_": "004",
          "listID": "CLASS",
          "name": "Consolidated Receipt"
        }]
      });
    } else {
      classifications.push({
        "ItemClassificationCode": [{
          "_": item.classification.code,
          "listID": item.classification.type || 'CLASS'
        }]
      });
    }
  }

  return classifications;
};

const partyIdentification = (value, schemeId) => ({
  "ID": [{
    "_": value,
    "schemeID": schemeId
  }]
});

const mapPartyIdentifications = (identifications = []) => {
  const idMap = identifications.reduce((acc, id) => {
    if (id && id.schemeId && hasMeaningfulValue(id.id)) {
      const schemeId = String(id.schemeId).toUpperCase();
      acc[schemeId] = clipIdByScheme(id.id, schemeId);
    }
    return acc;
  }, {});

  const result = [
    partyIdentification(hasMeaningfulValue(idMap.TIN) ? idMap.TIN : 'NA', 'TIN')
  ];

  const primaryScheme = PRIMARY_ID_SCHEMES.find((schemeId) => hasMeaningfulValue(idMap[schemeId]));
  if (primaryScheme) {
    result.push(partyIdentification(idMap[primaryScheme], primaryScheme));
  }

  ['SST', 'TTX'].forEach((schemeId) => {
    result.push(partyIdentification(
      hasMeaningfulValue(idMap[schemeId]) ? idMap[schemeId] : 'NA',
      schemeId
    ));
  });

  PARTY_ID_SCHEMES.forEach((schemeId) => {
    if (['TIN', 'SST', 'TTX'].includes(schemeId) || PRIMARY_ID_SCHEMES.includes(schemeId)) {
      return;
    }
    if (hasMeaningfulValue(idMap[schemeId])) {
      result.push(partyIdentification(idMap[schemeId], schemeId));
    }
  });

  return result;
};

const resolveSupplierIndustry = (supplier = {}) => {
  const industryName = resolveIndustryName({
    excelName: supplier.industryName,
    msicCode: supplier.industryClassificationCode,
    companyIndustry: supplier.companyIndustry
  });

  if (!isMeaningfulIndustry(industryName)) {
    throw new LhdnMappingError(
      'CF701',
      'Business activity description is required',
      {
        target: 'IndustryClassificationCode',
        propertyPath: 'Invoice.AccountingSupplierParty.Party.IndustryClassificationCode.name'
      }
    );
  }

  return {
    "_": String(supplier.industryClassificationCode || ''),
    "name": truncate(industryName, SDK_FIELD_LIMITS.industryName)
  };
};

const mapPartyAddress = (address) => {
  return {
    "CityName": wrapValue(address.city),
    "PostalZone": wrapValue(address.postcode),
    "CountrySubentityCode": wrapValue(address.state),
    "AddressLine": mapAddressLines(address.line || ""),
    "Country": [{
      "IdentificationCode": [{
        "_": address.country || "MYS",
        "listID": "ISO3166-1",
        "listAgencyID": "6"
      }]
    }]
  };
};

const DEFAULT_VALUES = {
  TAX_SCHEME: {
    id: 'OTH',
    schemeId: 'UN/ECE 5153',
    schemeAgencyId: '6'
  },
  TAX_CATEGORY: {
    id: '01',
    exemptionReason: 'NA'
  }
};

const mapTaxScheme = (scheme) => {
  const defaultScheme = DEFAULT_VALUES.TAX_SCHEME;
  return [{
    "ID": [{
      "_": String(scheme?.id || defaultScheme.id),
      "schemeID": scheme?.schemeId || defaultScheme.schemeId,
      "schemeAgencyID": scheme?.schemeAgencyId || defaultScheme.schemeAgencyId
    }]
  }];
};

const mapTaxCategory = (taxCategory, taxScheme) => {
  return [{
    "ID": wrapValue(String(taxCategory?.id || DEFAULT_VALUES.TAX_CATEGORY.id)),
    "TaxExemptionReason": taxCategory?.exemptionReason ? wrapValue(taxCategory.exemptionReason) : undefined,
    "TaxScheme": mapTaxScheme(taxScheme)
  }];
};


const mapTaxTotal = (taxTotal, documentCurrencyCode, taxCurrencyCode, { includePercent = false } = {}) => {
  if (!taxTotal) return [];

  const amountCurrency = taxCurrencyCode || documentCurrencyCode;

  return [{
      "TaxAmount": wrapValue(taxTotal.taxAmount, amountCurrency),
      "TaxSubtotal": taxTotal.taxSubtotal?.map(subtotal => ({
          "TaxableAmount": wrapValue(subtotal.taxableAmount, documentCurrencyCode),
          "TaxAmount": wrapValue(subtotal.taxAmount, amountCurrency),
          ...(includePercent ? {
            "Percent": wrapNumericValue(subtotal.taxCategory?.percent || 0)
          } : {}),
          "TaxCategory": [{
              "ID": [{
                  "_": subtotal.taxCategory?.id || DEFAULT_VALUES.TAX_CATEGORY.id
              }],
              "TaxExemptionReason": subtotal.taxCategory?.exemptionReason ?
                  wrapValue(subtotal.taxCategory.exemptionReason) : undefined,
              "TaxScheme": [{
                  "ID": [{
                      "_": subtotal.taxCategory?.taxScheme?.id || "OTH",
                      "schemeID": "UN/ECE 5153",
                      "schemeAgencyID": "6"
                  }]
              }]
          }]
      })) || []
  }];
};

const mapLineItem = (item, documentCurrencyCode, taxCurrencyCode, exchangeRate) => {
  if (!item) return null;

  // Special handling for consolidated receipts
  const isConsolidatedReceipt = item.item?.classification?.code === '004';
  const description = isConsolidatedReceipt ?
    `Receipt ${item.item.description}` :
    item.item.description;

  return {
    "ID": wrapValue(String(item.lineId)),
    "InvoicedQuantity": [{
      "_": Number(item.quantity),
      "unitCode": item.unitCode || ""
    }],
    "LineExtensionAmount": wrapValue(item.lineExtensionAmount, documentCurrencyCode),
    "AllowanceCharge": item.allowanceCharges.map(charge => ({
      "ChargeIndicator": wrapBoolean(charge.chargeIndicator),
      "AllowanceChargeReason": wrapValue(charge.reason || 'NA'),
      "MultiplierFactorNumeric": charge.multiplierFactorNumeric ? wrapNumericValue(charge.multiplierFactorNumeric) : undefined,
      "Amount": wrapValue(charge.amount, documentCurrencyCode || 0, documentCurrencyCode)
    })),
    "TaxTotal": mapTaxTotal(item.taxTotal, documentCurrencyCode, taxCurrencyCode, { includePercent: true }),
    "Item": [{
      "CommodityClassification": mapCommodityClassifications(item.item),
      "Description": wrapValue(description),
      "OriginCountry": [{
        "IdentificationCode": [{
          "_": item.item.originCountry || "MYS"
        }]
      }]
    }],
    "Price": [{
      "PriceAmount": wrapValue(item.price.amount, documentCurrencyCode)
    }],
    "ItemPriceExtension": [{
      "Amount": wrapValue(item.price.extension, documentCurrencyCode)
    }]
  };
};

const mapInvoiceLines = (items, documentCurrencyCode, taxCurrencyCode, exchangeRate) => {
  if (!items || !Array.isArray(items)) {
    return [];
  }
  return items.map(item => mapLineItem(item, documentCurrencyCode, taxCurrencyCode, exchangeRate)).filter(Boolean);
};

const mapDocumentReference = (reference) => {
  if (!reference || isEmptyOptional(reference.id)) {
    return null;
  }
  const mapped = {
    "ID": wrapValue(reference.id)
  };
  if (hasMeaningfulValue(reference.type)) {
    mapped.DocumentType = wrapValue(reference.type);
  }
  if (hasMeaningfulValue(reference.description)) {
    mapped.DocumentDescription = wrapValue(reference.description);
  }
  return mapped;
};

const adrSlot = (ref) => {
  if (ref?.incoterms) {
    return 3;
  }
  if (ref?.type === INVOICE_ADR_TYPES.CUSTOMS) {
    return 0;
  }
  if (ref?.type === INVOICE_ADR_TYPES.FTA) {
    return 1;
  }
  if (ref?.type === INVOICE_ADR_TYPES.K2) {
    return 2;
  }
  return 1;
};

const mapInvoiceAdditionalDocumentReferences = (doc) => {
  if (doc.header.documentReference?.invalidIncoterms) {
    throw new LhdnMappingError(
      'CF417',
      'Incoterms must be 1 to 3 letters with no special characters (for example CIF)',
      {
        target: 'Incoterms',
        propertyPath: 'Invoice.AdditionalDocumentReference.ID'
      }
    );
  }

  const refs = [...(doc.header.documentReference?.additionalRefs || [])]
    .sort((a, b) => adrSlot(a) - adrSlot(b))
    .map((ref) => {
      if (ref?.incoterms) {
        const code = String(ref.id || '').trim().toUpperCase();
        if (!hasMeaningfulValue(code) || !isValidIncoterms(code)) {
          throw new LhdnMappingError(
            'CF417',
            'Incoterms must be 1 to 3 letters with no special characters (for example CIF)',
            {
              target: 'Incoterms',
              propertyPath: 'Invoice.AdditionalDocumentReference.ID'
            }
          );
        }
        return { "ID": wrapValue(code) };
      }
      return mapDocumentReference(ref);
    })
    .filter(Boolean);

  return refs.length ? refs : undefined;
};

const mapBillingReference = (doc) => {
  const billingEntries = [];
  const originalId = doc.header.InvoiceDocumentReference_ID;
  const originalUuid = doc.header.invoiceDocumentReference;
  if (hasMeaningfulValue(originalId) || hasMeaningfulValue(originalUuid)) {
    billingEntries.push({
      "InvoiceDocumentReference": [{
        ...(hasMeaningfulValue(originalId) ? { "ID": wrapValue(originalId) } : {}),
        ...(hasMeaningfulValue(originalUuid) ? { "UUID": wrapValue(originalUuid) } : {})
      }]
    });
  }

  const billRef = doc.header.documentReference?.billingReference;
  if (hasMeaningfulValue(billRef)) {
    billingEntries.push({
      "AdditionalDocumentReference": [{
        "ID": wrapValue(truncate(billRef, SDK_FIELD_LIMITS.billReference || 150))
      }]
    });
  }

  return billingEntries.length ? billingEntries : undefined;
};

const mapInvoicePeriod = (period = {}) => {
  const startDate = wrapDate(period.startDate);
  const endDate = wrapDate(period.endDate);
  const description = hasMeaningfulValue(period.description)
    ? wrapValue(truncate(period.description, SDK_FIELD_LIMITS.billingFrequency))
    : undefined;

  if (!startDate && !endDate && !description) {
    return undefined;
  }

  return [{
    ...(startDate ? { "StartDate": startDate } : {}),
    ...(endDate ? { "EndDate": endDate } : {}),
    ...(description ? { "Description": description } : {})
  }];
};

const mapPaymentMeans = (payment = {}) => {
  const code = hasMeaningfulValue(payment.paymentMeansCode)
    ? wrapValue(String(payment.paymentMeansCode))
    : undefined;
  const account = hasMeaningfulValue(payment.payeeFinancialAccount)
    ? wrapValue(truncate(payment.payeeFinancialAccount, SDK_FIELD_LIMITS.bankAccount))
    : undefined;

  if (!code && !account) {
    return undefined;
  }

  return [{
    ...(code ? { "PaymentMeansCode": code } : {}),
    ...(account ? { "PayeeFinancialAccount": [{ "ID": account }] } : {})
  }];
};

const mapPaymentTerms = (payment = {}) => {
  if (!hasMeaningfulValue(payment.paymentTerms)) {
    return undefined;
  }
  return [{
    "Note": wrapValue(truncate(payment.paymentTerms, SDK_FIELD_LIMITS.paymentTerms))
  }];
};

const mapPrepaidPayment = (payment = {}, documentCurrencyCode) => {
  const prepaid = payment.prepaidPayment || {};
  const id = hasMeaningfulValue(prepaid.id)
    ? wrapValue(truncate(prepaid.id, SDK_FIELD_LIMITS.prepaidReference))
    : undefined;
  const amount = toPlainAmount(prepaid.amount);
  const hasAmount = amount !== undefined && Number(amount) !== 0;
  const date = wrapDate(prepaid.date);
  const time = hasMeaningfulValue(prepaid.time) ? wrapValue(prepaid.time) : undefined;

  if (!id && !hasAmount && !date && !time) {
    return undefined;
  }

  return [{
    ...(id ? { "ID": id } : {}),
    ...(hasAmount ? { "PaidAmount": wrapValue(amount, documentCurrencyCode) } : {}),
    ...(date ? { "PaidDate": date } : {}),
    ...(time ? { "PaidTime": time } : {})
  }];
};

const mapTaxExchangeRate = (header = {}) => {
  const documentCurrency = String(header.documentCurrencyCode || '').trim().toUpperCase();
  if (!documentCurrency || documentCurrency === 'MYR') {
    return undefined;
  }
  return [{
    "SourceCurrencyCode": [{ "_": header.documentCurrencyCode }],
    "TargetCurrencyCode": [{ "_": 'MYR' }],
    "CalculationRate": [{ "_": Number(header.exchangeRate) || 0 }]
  }];
};

const mapAdditionalAccountID = (supplier = {}) => {
  if (!hasMeaningfulValue(supplier.additionalAccountID)) {
    return undefined;
  }
  const account = { "_": String(supplier.additionalAccountID).trim() };
  if (hasMeaningfulValue(supplier.schemeAgencyName)) {
    account.schemeAgencyName = supplier.schemeAgencyName;
  }
  return [account];
};

const mapContact = (contact = {}) => ([{
  "Telephone": wrapValue(contact.phone),
  "ElectronicMail": wrapValue(contact.email)
}]);

const mapLegalEntity = (name) => ([{
  "RegistrationName": wrapValue(name)
}]);

const mapSupplierParty = (supplier = {}) => {
  const additionalAccountID = mapAdditionalAccountID(supplier);
  return [{
    ...(additionalAccountID ? { "AdditionalAccountID": additionalAccountID } : {}),
    "Party": [{
      "IndustryClassificationCode": [resolveSupplierIndustry(supplier)],
      "PartyIdentification": mapPartyIdentifications(supplier.identifications),
      "PostalAddress": [mapPartyAddress(supplier.address)],
      "PartyLegalEntity": mapLegalEntity(supplier.name),
      "Contact": mapContact(supplier.contact)
    }]
  }];
};

const mapBuyerParty = (buyer = {}) => ([{
  "Party": [{
    "PostalAddress": [mapPartyAddress(buyer.address)],
    "PartyLegalEntity": mapLegalEntity(buyer.name),
    "PartyIdentification": mapPartyIdentifications(buyer.identifications),
    "Contact": mapContact(buyer.contact)
  }]
}]);

const mapDelivery = (delivery, documentCurrencyCode, invoiceNo) => {
  if (!hasMeaningfulValue(delivery?.name)) {
    return undefined;
  }

  const deliveryParty = {
    "PartyLegalEntity": mapLegalEntity(delivery.name),
    ...(delivery.address ? { "PostalAddress": [mapPartyAddress(delivery.address)] } : {}),
    "PartyIdentification": mapPartyIdentifications(delivery.identifications)
  };

  const freight = delivery.shipment?.freightAllowanceCharge;
  let freightAllowanceCharge;
  if (hasShipmentFreightCharge(delivery)) {
    const reason = hasMeaningfulValue(freight?.reason)
      ? wrapValue(freight.reason)
      : undefined;
    freightAllowanceCharge = [{
      "ChargeIndicator": wrapBoolean(true),
      ...(reason ? { "AllowanceChargeReason": reason } : {}),
      "Amount": wrapValue(freight.amount, documentCurrencyCode)
    }];
  }

  let shipment;
  if (shouldEmitDeliveryShipment(delivery)) {
    const shipmentId = resolveDeliveryShipmentId(delivery, invoiceNo);
    if (hasMeaningfulValue(shipmentId)) {
      shipment = [{
        "ID": wrapValue(shipmentId),
        ...(freightAllowanceCharge ? { "FreightAllowanceCharge": freightAllowanceCharge } : {})
      }];
    }
  }

  return [{
    "DeliveryParty": [deliveryParty],
    ...(shipment ? { "Shipment": shipment } : {})
  }];
};

const mapToLHDNFormat = (excelData, version) => {
  const logger = createLogger();

  if (!excelData || !Array.isArray(excelData) || excelData.length === 0) {
    const error = new Error('No document data provided');
    logger.logError(error, { excelData });
    throw error;
  }

  const doc = excelData[0];

  if (!doc || !doc.header || !doc.header.invoiceNo) {
    const error = new Error('Invalid document structure');
    logger.logError(error, { doc });
    throw error;
  }

  try {
    logger.logStep('Starting LHDN mapping', { version, documentId: doc.header.invoiceNo });

    // Log input document structure
    logger.logStep('Input Document Structure', {
      header: doc.header,
      parties: {
        supplier: doc.supplier,
        buyer: doc.buyer,
        delivery: doc.delivery
      },
      itemsCount: doc.items?.length,
      summary: doc.summary
    });

    const invoicePeriod = mapInvoicePeriod(doc.header.invoicePeriod);
    const billingReference = mapBillingReference(doc);
    const additionalDocumentReferences = mapInvoiceAdditionalDocumentReferences(doc);
    const paymentMeans = mapPaymentMeans(doc.payment);
    const paymentTerms = mapPaymentTerms(doc.payment);
    const prepaidPayment = mapPrepaidPayment(doc.payment, doc.header.documentCurrencyCode);
    const taxExchangeRate = mapTaxExchangeRate(doc.header);
    const delivery = mapDelivery(doc.delivery, doc.header.documentCurrencyCode, doc.header.invoiceNo);
    const supplierParty = mapSupplierParty(doc.supplier);
    const buyerParty = mapBuyerParty(doc.buyer);
    const taxTotal = mapTaxTotal(doc.summary?.taxTotal, doc.header.documentCurrencyCode, doc.header.taxCurrencyCode);
    const legalMonetaryTotal = [{
      "LineExtensionAmount": wrapValue(doc.summary.amounts.lineExtensionAmount, doc.header.documentCurrencyCode),
      "TaxExclusiveAmount": wrapValue(doc.summary.amounts.taxExclusiveAmount, doc.header.documentCurrencyCode),
      "TaxInclusiveAmount": wrapValue(doc.summary.amounts.taxInclusiveAmount, doc.header.documentCurrencyCode),
      "AllowanceTotalAmount": wrapValue(doc.summary.amounts.allowanceTotalAmount, doc.header.documentCurrencyCode),
      "ChargeTotalAmount": wrapValue(doc.summary.amounts.chargeTotalAmount, doc.header.documentCurrencyCode),
      "PayableRoundingAmount": wrapValue(doc.summary.amounts.payableRoundingAmount, doc.header.documentCurrencyCode),
      "PayableAmount": wrapValue(doc.summary.amounts.payableAmount, doc.header.documentCurrencyCode)
    }];

    const lhdnFormat = {
      "_D": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
      "_A": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
      "_B": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
      "Invoice": [{
        "ID": wrapValue(doc.header.invoiceNo),
        "IssueDate": doc.header.issueDate,
        "IssueTime": doc.header.issueTime,
        "InvoiceTypeCode": [{
          "_": doc.header.invoiceType,
          "listVersionID": version
        }],
        "DocumentCurrencyCode": wrapValue(doc.header.documentCurrencyCode),
        "TaxCurrencyCode": wrapValue(doc.header.taxCurrencyCode),
        ...(taxExchangeRate ? { "TaxExchangeRate": taxExchangeRate } : {}),
        ...(invoicePeriod ? { "InvoicePeriod": invoicePeriod } : {}),
        ...(billingReference ? { "BillingReference": billingReference } : {}),
        ...(additionalDocumentReferences ? {
          "AdditionalDocumentReference": additionalDocumentReferences
        } : {}),
        "AccountingSupplierParty": supplierParty,
        "AccountingCustomerParty": buyerParty,
        ...(delivery ? { "Delivery": delivery } : {}),
        ...(paymentMeans ? { "PaymentMeans": paymentMeans } : {}),
        ...(paymentTerms ? { "PaymentTerms": paymentTerms } : {}),
        ...(prepaidPayment ? { "PrepaidPayment": prepaidPayment } : {}),
        "AllowanceCharge": mapAllowanceCharges(doc.allowanceCharge),
        "TaxTotal": taxTotal,
        "LegalMonetaryTotal": legalMonetaryTotal,
        "InvoiceLine": mapInvoiceLines(doc.items, doc.header.documentCurrencyCode, doc.header.taxCurrencyCode, doc.header.exchangeRate)
      }]
    };

    logger.logMapping('Header', doc.header, lhdnFormat.Invoice[0]);
    logger.logMapping('Supplier', doc.supplier, supplierParty);
    logger.logMapping('Buyer', doc.buyer, buyerParty);
    logger.logMapping('TaxAndTotals', {
      taxTotal: doc.summary?.taxTotal,
      amounts: doc.summary?.amounts
    }, { TaxTotal: taxTotal, LegalMonetaryTotal: legalMonetaryTotal });

    // Add digital signature for version 1.1
    if (version === '1.1') {
      try {
        logger.logStep('Adding Digital Signature', { version });
        const { certificateJsonPortion_Signature, certificateJsonPortion_UBLExtensions } =
          getCertificatesHashedParams(lhdnFormat);

        lhdnFormat.Invoice[0].UBLExtensions = certificateJsonPortion_UBLExtensions;
        lhdnFormat.Invoice[0].Signature = certificateJsonPortion_Signature;

        logger.logMapping('DigitalSignature',
          { version, hasSignature: true },
          { UBLExtensions: lhdnFormat.Invoice[0].UBLExtensions, Signature: lhdnFormat.Invoice[0].Signature }
        );
      } catch (error) {
        logger.logError(error, { version, stage: 'digital_signature' });
        throw new Error('Failed to add digital signature for version 1.1');
      }
    }

    // Clean the object
    const cleanObject = (obj) => {
      Object.keys(obj).forEach(key => {
        if (obj[key] === undefined || obj[key] === null) {
          delete obj[key];
        } else if (typeof obj[key] === 'object') {
          cleanObject(obj[key]);
        }
      });
      return obj;
    };

    const cleanedFormat = cleanObject(lhdnFormat);
    logger.logStep('Mapping Complete', {
      documentId: doc.header?.invoiceNo,
      version,
      hasSignature: version === '1.1'
    });

    // Write both logs and LHDN format
    logger.writeLogs(doc.header?.invoiceNo || 'unknown', cleanedFormat);

    return cleanedFormat;

  } catch (error) {
    logger.logError(error, { stage: 'mapping', documentId: doc.header?.invoiceNo });
    throw error;
  }
};

module.exports = { mapToLHDNFormat, LhdnMappingError };