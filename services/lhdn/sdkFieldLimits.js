/**
 * LHDN SDK 1.0 invoice field limits (production from 15 Aug 2026;
 * amount/passport rules from 23 Oct 2026).
 */
const path = require('path');

const SDK_FIELD_LIMITS = {
  invoiceNumber: 50,
  bankAccount: 150,
  incoterms: 3,
  industryName: 300,
  paymentTerms: 300,
  prepaidReference: 150,
  billingFrequency: 50,
  certExAuthNumber: 300,
  passport: 12,
  nric: 12,
  army: 12,
  brn: 20,
  amountDigits: 26,
  billReference: 150
};

const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const INCOTERMS_RE = /^[A-Za-z]{1,3}$/;
const INCOTERMS_HEURISTIC_RE = /^[A-Za-z]{3}$/;
const EMPTY_TOKENS = new Set(['', 'NA', 'N/A', 'N.A.', 'NOT APPLICABLE', 'NONE', 'NULL', 'UNDEFINED']);

const INVOICE_ADR_TYPES = {
  CUSTOMS: 'CustomsImportForm',
  FTA: 'FreeTradeAgreement',
  K2: 'K2'
};

const PRIMARY_ID_SCHEMES = ['BRN', 'NRIC', 'PASSPORT', 'ARMY'];
const PARTY_ID_SCHEMES = ['TIN', 'BRN', 'NRIC', 'PASSPORT', 'ARMY', 'SST', 'TTX'];

const ID_LENGTH_BY_SCHEME = {
  PASSPORT: SDK_FIELD_LIMITS.passport,
  NRIC: SDK_FIELD_LIMITS.nric,
  ARMY: SDK_FIELD_LIMITS.army,
  BRN: SDK_FIELD_LIMITS.brn
};

let msicByCode = null;

class LhdnMappingError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'LhdnMappingError';
    this.code = code;
    this.target = extra.target;
    this.propertyPath = extra.propertyPath;
    this.details = extra.details;
  }
}

const normalizeToken = (value) => String(value ?? '').trim().toUpperCase();

const isEmptyOptional = (value) => {
  if (value === null || value === undefined) {
    return true;
  }
  return EMPTY_TOKENS.has(normalizeToken(value));
};

const hasMeaningfulValue = (value) => !isEmptyOptional(value);

const truncate = (value, max) => {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  if (typeof max !== 'number' || text.length <= max) {
    return text;
  }
  return text.slice(0, max);
};

const loadMsicMap = () => {
  if (msicByCode) {
    return msicByCode;
  }
  msicByCode = new Map();
  try {
    const codes = require(path.join(__dirname, 'data', 'MSICSubCategoryCodes.json'));
    if (Array.isArray(codes)) {
      codes.forEach((row) => {
        if (row && row.Code != null) {
          msicByCode.set(String(row.Code).trim(), String(row.Description || '').trim());
        }
      });
    }
  } catch (error) {
    console.error('[WARN] Failed to load MSIC codes:', error.message);
  }
  return msicByCode;
};

const getMsicDescription = (code) => {
  if (isEmptyOptional(code)) {
    return '';
  }
  const description = loadMsicMap().get(String(code).trim()) || '';
  if (isEmptyOptional(description)) {
    return '';
  }
  return description;
};

const isMeaningfulIndustry = (value) => {
  if (isEmptyOptional(value)) {
    return false;
  }
  const normalized = normalizeToken(value);
  return normalized !== '00000';
};

const resolveIndustryName = ({ excelName, msicCode, companyIndustry } = {}) => {
  if (isMeaningfulIndustry(excelName)) {
    return truncate(String(excelName).trim(), SDK_FIELD_LIMITS.industryName);
  }
  const fromMsic = getMsicDescription(msicCode);
  if (isMeaningfulIndustry(fromMsic)) {
    return truncate(fromMsic, SDK_FIELD_LIMITS.industryName);
  }
  if (isMeaningfulIndustry(companyIndustry)) {
    return truncate(String(companyIndustry).trim(), SDK_FIELD_LIMITS.industryName);
  }
  return '';
};

const isValidIsoDate = (value) => {
  if (isEmptyOptional(value)) {
    return false;
  }
  return DATE_ISO_RE.test(String(value).trim());
};

const excelSerialToIsoDate = (serial) => {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 20000 || n > 80000) {
    return '';
  }
  const utc = Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000;
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().slice(0, 10);
};

const toIsoDate = (value) => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (isEmptyOptional(raw)) {
    return undefined;
  }
  if (DATE_ISO_RE.test(raw)) {
    return raw;
  }
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const fromSerial = excelSerialToIsoDate(raw);
    if (fromSerial) {
      return fromSerial;
    }
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString().slice(0, 10);
};

const countAmountDigits = (value) => {
  const text = String(value ?? '').trim();
  if (!text) {
    return 0;
  }
  return text.replace(/[-.]/g, '').replace(/\D/g, '').length;
};

const toPlainAmount = (value) => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  let text = String(value).trim();
  if (isEmptyOptional(text)) {
    return undefined;
  }
  if (/[eE]/.test(text)) {
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) {
      return undefined;
    }
    text = numeric.toLocaleString('en-US', {
      useGrouping: false,
      maximumFractionDigits: 8
    });
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  if (countAmountDigits(text) > SDK_FIELD_LIMITS.amountDigits) {
    const [whole, fraction = ''] = String(Math.abs(numeric)).split('.');
    const sign = numeric < 0 ? '-' : '';
    const clippedWhole = whole.slice(0, SDK_FIELD_LIMITS.amountDigits);
    const remaining = SDK_FIELD_LIMITS.amountDigits - clippedWhole.length;
    const clippedFrac = remaining > 0 ? fraction.slice(0, remaining) : '';
    return Number(`${sign}${clippedWhole}${clippedFrac ? `.${clippedFrac}` : ''}`);
  }
  return numeric;
};

const isTrueChargeIndicator = (value) => (
  value === true || value === 'true' || value === 1 || value === '1'
);

const isMeaningfulNonZeroAmount = (value) => {
  const amount = toPlainAmount(value);
  return amount !== undefined && amount !== 0;
};

const hasShipmentFreightCharge = (delivery) => {
  const freight = delivery?.shipment?.freightAllowanceCharge;
  if (!freight) {
    return false;
  }
  return isTrueChargeIndicator(freight.indicator) && isMeaningfulNonZeroAmount(freight.amount);
};

const shouldEmitDeliveryShipment = (delivery) => (
  hasShipmentFreightCharge(delivery) || hasMeaningfulValue(delivery?.shipment?.id)
);

const resolveDeliveryShipmentId = (delivery, invoiceNo) => {
  if (hasMeaningfulValue(delivery?.shipment?.id)) {
    return String(delivery.shipment.id).trim();
  }
  if (hasMeaningfulValue(invoiceNo)) {
    return String(invoiceNo).trim();
  }
  return '';
};

const exceedsAmountDigits = (value) => {
  if (value === null || value === undefined || value === '') {
    return false;
  }
  return countAmountDigits(value) > SDK_FIELD_LIMITS.amountDigits;
};

const clipIdByScheme = (id, schemeId) => {
  if (isEmptyOptional(id)) {
    return '';
  }
  const text = String(id).trim();
  const max = ID_LENGTH_BY_SCHEME[String(schemeId || '').toUpperCase()];
  return max ? truncate(text, max) : text;
};

const isValidIncoterms = (value) => INCOTERMS_RE.test(String(value ?? '').trim());

const normalizeDocumentType = (value) => String(value ?? '').replace(/\s+/g, '').trim();

const classifyAdditionalDocumentReference = (id, documentType) => {
  const rawId = hasMeaningfulValue(id) ? String(id).trim() : '';
  const rawType = hasMeaningfulValue(documentType) ? String(documentType).trim() : '';
  const typeKey = normalizeDocumentType(rawType).toUpperCase();

  if (!rawId && !rawType) {
    return { billReference: '', invoiceReferences: [], invalidIncoterms: null };
  }

  if (typeKey === 'CUSTOMSIMPORTFORM' || typeKey === 'CUSTOMS' || /CUSTOMSIMPORT/i.test(rawType)) {
    return {
      billReference: '',
      invoiceReferences: rawId
        ? [{ id: rawId, type: INVOICE_ADR_TYPES.CUSTOMS }]
        : [],
      invalidIncoterms: null
    };
  }

  if (typeKey === 'FREETRADEAGREEMENT' || typeKey === 'FTA' || /FREE\s*TRADE/i.test(rawType)) {
    return {
      billReference: '',
      invoiceReferences: [{ id: 'FTA', type: INVOICE_ADR_TYPES.FTA }],
      invalidIncoterms: null
    };
  }

  if (typeKey === 'K2' || /^K2$/i.test(rawId)) {
    return {
      billReference: '',
      invoiceReferences: [{ id: rawId || 'K2', type: INVOICE_ADR_TYPES.K2 }],
      invalidIncoterms: null
    };
  }

  const typedIncoterms = /INCOTERM/i.test(rawType);
  if (typedIncoterms) {
    if (!rawId || !isValidIncoterms(rawId)) {
      return {
        billReference: '',
        invoiceReferences: [],
        invalidIncoterms: rawId || rawType
      };
    }
    return {
      billReference: '',
      invoiceReferences: [{ id: rawId.toUpperCase(), type: null, incoterms: true }],
      invalidIncoterms: null
    };
  }

  if (rawId && INCOTERMS_HEURISTIC_RE.test(rawId) && !rawType) {
    return {
      billReference: '',
      invoiceReferences: [{ id: rawId.toUpperCase(), type: null, incoterms: true }],
      invalidIncoterms: null
    };
  }

  return {
    billReference: rawId,
    invoiceReferences: [],
    invalidIncoterms: null
  };
};

const collectSdkValidationErrors = (doc) => {
  const errors = [];
  if (!doc) {
    return errors;
  }

  const invoiceNo = doc.header?.invoiceNo;
  if (hasMeaningfulValue(invoiceNo) && String(invoiceNo).trim().length > SDK_FIELD_LIMITS.invoiceNumber) {
    errors.push({
      code: 'CF401',
      message: `Invoice number must not exceed ${SDK_FIELD_LIMITS.invoiceNumber} characters`,
      target: 'ID',
      propertyPath: 'Invoice.ID'
    });
  }

  if (shouldEmitDeliveryShipment(doc.delivery)) {
    const shipmentId = resolveDeliveryShipmentId(doc.delivery, invoiceNo);
    if (!shipmentId) {
      errors.push({
        code: 'CF421',
        message: 'Shipment ID is required when extra charges are included',
        target: 'Shipment',
        propertyPath: 'Invoice.Delivery.Shipment.ID'
      });
    }
  }

  const industryName = doc.supplier?.industryName;
  if (!isMeaningfulIndustry(industryName)) {
    errors.push({
      code: 'CF701',
      message: 'Business activity description is required',
      target: 'IndustryClassificationCode',
      propertyPath: 'Invoice.AccountingSupplierParty.Party.IndustryClassificationCode.name'
    });
  } else if (String(industryName).length > SDK_FIELD_LIMITS.industryName) {
    errors.push({
      code: 'CF701',
      message: `Business activity description must not exceed ${SDK_FIELD_LIMITS.industryName} characters`,
      target: 'IndustryClassificationCode',
      propertyPath: 'Invoice.AccountingSupplierParty.Party.IndustryClassificationCode.name'
    });
  }

  const classified = classifyAdditionalDocumentReference(
    doc.header?.documentReference?.rawAdditionalDocumentReference,
    doc.header?.documentReference?.billingReferenceType
  );
  if (classified.invalidIncoterms) {
    errors.push({
      code: 'CF417',
      message: 'Incoterms must be 1 to 3 letters with no special characters (for example CIF)',
      target: 'Incoterms',
      propertyPath: 'Invoice.AdditionalDocumentReference.ID'
    });
  }

  const certEx = doc.supplier?.additionalAccountID;
  if (hasMeaningfulValue(certEx) && String(certEx).trim().length > SDK_FIELD_LIMITS.certExAuthNumber) {
    errors.push({
      code: 'CF413',
      message: `Certified exporter authorisation number must not exceed ${SDK_FIELD_LIMITS.certExAuthNumber} characters`,
      target: 'AdditionalAccountID',
      propertyPath: 'Invoice.AccountingSupplierParty.AdditionalAccountID'
    });
  }

  const bank = doc.payment?.payeeFinancialAccount;
  if (hasMeaningfulValue(bank) && String(bank).trim().length > SDK_FIELD_LIMITS.bankAccount) {
    errors.push({
      code: 'CF414',
      message: `Bank account number must not exceed ${SDK_FIELD_LIMITS.bankAccount} characters`,
      target: 'PayeeFinancialAccount',
      propertyPath: 'Invoice.PaymentMeans.PayeeFinancialAccount.ID'
    });
  }

  const paymentTerms = doc.payment?.paymentTerms;
  if (hasMeaningfulValue(paymentTerms) && String(paymentTerms).trim().length > SDK_FIELD_LIMITS.paymentTerms) {
    errors.push({
      code: 'CF415',
      message: `Payment terms must not exceed ${SDK_FIELD_LIMITS.paymentTerms} characters`,
      target: 'PaymentTerms',
      propertyPath: 'Invoice.PaymentTerms.Note'
    });
  }

  const prepaidId = doc.payment?.prepaidPayment?.id;
  if (hasMeaningfulValue(prepaidId) && String(prepaidId).trim().length > SDK_FIELD_LIMITS.prepaidReference) {
    errors.push({
      code: 'CF416',
      message: `Prepayment reference must not exceed ${SDK_FIELD_LIMITS.prepaidReference} characters`,
      target: 'PrepaidPayment',
      propertyPath: 'Invoice.PrepaidPayment.ID'
    });
  }

  const billingFreq = doc.header?.invoicePeriod?.description;
  if (hasMeaningfulValue(billingFreq) && String(billingFreq).trim().length > SDK_FIELD_LIMITS.billingFrequency) {
    errors.push({
      code: 'CF418',
      message: `Frequency of billing must not exceed ${SDK_FIELD_LIMITS.billingFrequency} characters`,
      target: 'InvoicePeriod',
      propertyPath: 'Invoice.InvoicePeriod.Description'
    });
  }

  ['startDate', 'endDate'].forEach((field) => {
    const raw = doc.header?.invoicePeriod?.[field];
    if (hasMeaningfulValue(raw) && !toIsoDate(raw)) {
      errors.push({
        code: 'CF410',
        message: 'Dates must use YYYY-MM-DD. Values such as N/A are not allowed',
        target: 'InvoicePeriod',
        propertyPath: `Invoice.InvoicePeriod.${field === 'startDate' ? 'StartDate' : 'EndDate'}`
      });
    }
  });

  const prepaidDate = doc.payment?.prepaidPayment?.date;
  if (hasMeaningfulValue(prepaidDate) && !toIsoDate(prepaidDate)) {
    errors.push({
      code: 'CF410',
      message: 'Dates must use YYYY-MM-DD. Values such as N/A are not allowed',
      target: 'PrepaidPayment',
      propertyPath: 'Invoice.PrepaidPayment.PaidDate'
    });
  }

  const checkPartyIds = (party, label, pathPrefix) => {
    (party?.identifications || []).forEach((id) => {
      if (!id || isEmptyOptional(id.id)) {
        return;
      }
      const scheme = String(id.schemeId || '').toUpperCase();
      const max = ID_LENGTH_BY_SCHEME[scheme];
      if (max && String(id.id).trim().length > max) {
        errors.push({
          code: 'CF419',
          message: `${scheme} must not exceed ${max} characters`,
          target: 'PartyIdentification',
          propertyPath: `${pathPrefix}.PartyIdentification`
        });
      }
    });
  };
  checkPartyIds(doc.supplier, 'Supplier', 'Invoice.AccountingSupplierParty.Party');
  checkPartyIds(doc.buyer, 'Buyer', 'Invoice.AccountingCustomerParty.Party');

  const amountTargets = [
    [doc.summary?.amounts?.lineExtensionAmount, 'Invoice.LegalMonetaryTotal.LineExtensionAmount'],
    [doc.summary?.amounts?.taxExclusiveAmount, 'Invoice.LegalMonetaryTotal.TaxExclusiveAmount'],
    [doc.summary?.amounts?.taxInclusiveAmount, 'Invoice.LegalMonetaryTotal.TaxInclusiveAmount'],
    [doc.summary?.amounts?.payableAmount, 'Invoice.LegalMonetaryTotal.PayableAmount'],
    [doc.summary?.taxTotal?.taxAmount, 'Invoice.TaxTotal.TaxAmount']
  ];
  amountTargets.forEach(([amount, propertyPath]) => {
    if (exceedsAmountDigits(amount) || (amount != null && /[eE]/.test(String(amount)))) {
      errors.push({
        code: 'CF420',
        message: `Amount fields must be plain numbers of at most ${SDK_FIELD_LIMITS.amountDigits} digits`,
        target: 'Amount',
        propertyPath
      });
    }
  });

  (doc.items || []).forEach((item, index) => {
    const lineAmounts = [item.lineExtensionAmount, item.price?.amount, item.taxTotal?.taxAmount];
    if (lineAmounts.some((amount) => exceedsAmountDigits(amount) || (amount != null && /[eE]/.test(String(amount))))) {
      errors.push({
        code: 'CF420',
        message: `Amount fields must be plain numbers of at most ${SDK_FIELD_LIMITS.amountDigits} digits`,
        target: 'Amount',
        propertyPath: `Invoice.InvoiceLine[${index + 1}]`
      });
    }
  });

  return errors;
};

module.exports = {
  SDK_FIELD_LIMITS,
  PARTY_ID_SCHEMES,
  PRIMARY_ID_SCHEMES,
  INVOICE_ADR_TYPES,
  LhdnMappingError,
  isEmptyOptional,
  hasMeaningfulValue,
  truncate,
  getMsicDescription,
  isMeaningfulIndustry,
  resolveIndustryName,
  isValidIsoDate,
  toIsoDate,
  toPlainAmount,
  exceedsAmountDigits,
  clipIdByScheme,
  isValidIncoterms,
  classifyAdditionalDocumentReference,
  collectSdkValidationErrors,
  hasShipmentFreightCharge,
  shouldEmitDeliveryShipment,
  resolveDeliveryShipmentId
};
