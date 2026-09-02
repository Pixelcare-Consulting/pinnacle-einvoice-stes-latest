/**
 * Local LHDN mapping review runner.
 * Maps processed-document fixtures through mapToLHDNFormat, checks shape
 * against the official Invoice v1.0 sample, and writes logs/lhdn-review/.
 *
 * Usage (from repo root): node services/lhdn/reviewMapping.js
 */
const fs = require('fs');
const https = require('https');
const Module = require('module');
const path = require('path');

const originalLoad = Module._load;
Module._load = function loadWithMapperStub(request, parent, isMain) {
  const parentFile = parent && parent.filename ? parent.filename : '';
  if (request === './lhdnService' && parentFile.replace(/\\/g, '/').endsWith('/services/lhdn/lhdnMapper.js')) {
    return {
      getCertificatesHashedParams: () => {
        throw new Error('Digital signature is not used for Invoice v1.0 review');
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { mapToLHDNFormat, LhdnMappingError } = require('./lhdnMapper');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(PROJECT_ROOT, 'logs', 'lhdn-review');
const SAMPLE_URL = 'https://sdk.myinvois.hasil.gov.my/files/sdksamples/1.0-Invoice-Sample.json';
const SAMPLE_CANDIDATES = [
  path.join(PROJECT_ROOT, 'uploads', '1.0-Invoice-Sample-0.json'),
  path.join(
    process.env.USERPROFILE || '',
    '.cursor',
    'projects',
    'c-PXC-GILBERT-1-Development-4-Malaysia-e-Invoice-TEK-Auto-pinnalce-einvoice',
    'uploads',
    '1.0-Invoice-Sample-0.json'
  )
];

const LONG_BILL_REF = 'PO-NOT-APPLICABLE-INV260826080182-EXTRA-LONG-BILLING-REFERENCE';

const check = (pathName, expected, actual, pass) => ({
  path: pathName,
  expected,
  actual: actual === undefined ? null : actual,
  pass: Boolean(pass)
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const parseJsonLoose = (raw) => {
  const text = String(raw);
  const start = text.indexOf('{');
  if (start < 0) {
    throw new Error('No JSON object found in sample');
  }
  return JSON.parse(text.slice(start));
};

const fetchHttpsJson = (url) => new Promise((resolve, reject) => {
  https.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      fetchHttpsJson(res.headers.location).then(resolve).catch(reject);
      return;
    }
    if (res.statusCode !== 200) {
      reject(new Error(`Failed to fetch sample: HTTP ${res.statusCode}`));
      res.resume();
      return;
    }
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      try {
        resolve(parseJsonLoose(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
  }).on('error', reject);
});

const loadOfficialSample = async () => {
  for (const candidate of SAMPLE_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) {
      return parseJsonLoose(fs.readFileSync(candidate, 'utf8'));
    }
  }
  return fetchHttpsJson(SAMPLE_URL);
};

const identifications = ({ tin, brn, sst, ttx }) => {
  const ids = [
    { id: tin, schemeId: 'TIN' },
    { id: brn, schemeId: 'BRN' }
  ];
  if (sst !== undefined) {
    ids.push({ id: sst, schemeId: 'SST' });
  }
  if (ttx !== undefined) {
    ids.push({ id: ttx, schemeId: 'TTX' });
  }
  return ids;
};

const malaysianAddress = () => ({
  line: 'Lot 66, Bangunan Merdeka, Persiaran Jaya',
  city: 'Kuala Lumpur',
  postcode: '50480',
  state: '10',
  country: 'MYS'
});

const baseProcessedDoc = () => ({
  header: {
    invoiceNo: 'JSON-INV12345',
    invoiceType: '01',
    documentCurrencyCode: 'MYR',
    currency: 'MYR',
    taxCurrencyCode: 'MYR',
    exchangeRate: 0,
    invoiceDocumentReference: '',
    InvoiceDocumentReference_ID: '',
    documentReference: {
      uuid: '',
      internalId: '',
      billingReference: 'E12345678912',
      billingReferenceType: '',
      rawAdditionalDocumentReference: '',
      additionalRefs: [
        { id: 'E12345678912', type: 'CustomsImportForm' },
        {
          id: 'FTA',
          type: 'FreeTradeAgreement',
          description: 'asddasdwqfd ddq'
        },
        { id: 'E12345678912', type: 'K2' },
        { id: 'CIF', incoterms: true }
      ],
      invalidIncoterms: null
    },
    issueDate: [{ _: '2024-07-23' }],
    issueTime: [{ _: '00:30:00Z' }],
    invoicePeriod: {
      startDate: '2024-01-01',
      endDate: '2024-07-31',
      description: 'Monthly'
    }
  },
  supplier: {
    additionalAccountID: 'CPT-CCN-W-211111-KL-000002',
    schemeAgencyName: 'CertEX',
    industryClassificationCode: '46510',
    industryName: 'Wholesale of computer hardware, software and peripherals',
    identifications: identifications({
      tin: "Supplier's TIN",
      brn: "Supplier's BRN"
    }),
    name: "Supplier's Name",
    address: malaysianAddress(),
    contact: {
      phone: '+60123456789',
      email: 'supplier@email.com'
    }
  },
  buyer: {
    identifications: identifications({
      tin: "Buyer's TIN",
      brn: "Buyer's BRN"
    }),
    name: "Buyer's Name",
    address: malaysianAddress(),
    contact: {
      phone: '+60123456789',
      email: 'buyer@email.com'
    }
  },
  delivery: {
    identifications: identifications({
      tin: "Recipient's TIN",
      brn: "Recipient's BRN"
    }),
    name: "Recipient's Name",
    address: malaysianAddress(),
    shipment: {
      id: '1234',
      freightAllowanceCharge: {
        indicator: true,
        reason: 'Service charge',
        amount: 100
      }
    }
  },
  payment: {
    paymentMeansCode: '03',
    payeeFinancialAccount: '1234567890123',
    paymentTerms: 'Payment method is cash',
    prepaidPayment: {
      id: 'E12345678912',
      amount: 1,
      date: '2024-07-23',
      time: '00:30:00Z'
    }
  },
  items: [{
    lineId: '1234',
    quantity: 1,
    unitCode: 'C62',
    lineExtensionAmount: 1436.5,
    allowanceCharges: [{
      chargeIndicator: false,
      reason: 'Sample Description',
      multiplierFactorNumeric: 0.15,
      amount: 100
    }],
    taxTotal: {
      taxAmount: 1460.5,
      taxSubtotal: [{
        taxableAmount: 1460.5,
        taxAmount: 1460.5,
        taxCategory: {
          id: 'E',
          percent: 6,
          exemptionReason: 'Exempt New Means of Transport',
          taxScheme: { id: 'OTH' }
        }
      }]
    },
    item: {
      ptcCode: '9800.00.0010',
      classification: { code: '003', type: 'CLASS' },
      description: 'Laptop Peripherals',
      originCountry: 'MYS'
    },
    price: {
      amount: 17,
      extension: 100
    }
  }],
  summary: {
    amounts: {
      lineExtensionAmount: 1436.5,
      taxExclusiveAmount: 1436.5,
      taxInclusiveAmount: 1436.5,
      allowanceTotalAmount: 1436.5,
      chargeTotalAmount: 1436.5,
      payableRoundingAmount: 0.3,
      payableAmount: 1436.5
    },
    taxTotal: {
      taxAmount: 87.63,
      taxSubtotal: [{
        taxableAmount: 87.63,
        taxAmount: 87.63,
        taxCategory: {
          id: '01',
          percent: 6,
          taxScheme: { id: 'OTH' }
        }
      }]
    }
  },
  allowanceCharge: {
    indicator: false,
    reason: 'Sample Description',
    amount: 100
  }
});

const withDoc = (mutator) => {
  const doc = clone(baseProcessedDoc());
  mutator(doc);
  return doc;
};

const invoiceOf = (payload) => payload?.Invoice?.[0] || {};

const partyOf = (payload, partyKey) => (
  invoiceOf(payload)?.[partyKey]?.[0]?.Party?.[0] || {}
);

const schemeValue = (party, schemeId) => {
  const match = (party.PartyIdentification || []).find((entry) => (
    entry?.ID?.[0]?.schemeID === schemeId
  ));
  return match?.ID?.[0]?._;
};

const collectPaths = (value, predicate, current = '$', found = []) => {
  if (predicate(value, current)) {
    found.push(current);
  }
  if (!value || typeof value !== 'object') {
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectPaths(item, predicate, `${current}[${index}]`, found));
    return found;
  }
  Object.keys(value).forEach((key) => {
    collectPaths(value[key], predicate, `${current}.${key}`, found);
  });
  return found;
};

const walkKeyOrder = (actual, expected, currentPath, checks) => {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)
      && actual && typeof actual === 'object' && !Array.isArray(actual)) {
    const expectedKeys = Object.keys(expected);
    const actualKeys = Object.keys(actual);
    const expectedPresent = expectedKeys.filter((key) => actualKeys.includes(key));
    const actualFromExpected = actualKeys.filter((key) => expectedKeys.includes(key));
    checks.push(check(
      `${currentPath}#keyOrder`,
      expectedPresent.join(', '),
      actualFromExpected.join(', '),
      expectedPresent.join('|') === actualFromExpected.join('|')
    ));
    expectedPresent.forEach((key) => {
      walkKeyOrder(actual[key], expected[key], `${currentPath}.${key}`, checks);
    });
    return;
  }

  if (Array.isArray(expected) && Array.isArray(actual)
      && expected[0] && actual[0]
      && typeof expected[0] === 'object' && typeof actual[0] === 'object') {
    const count = Math.min(expected.length, actual.length);
    for (let index = 0; index < count; index += 1) {
      walkKeyOrder(actual[index], expected[index], `${currentPath}[${index}]`, checks);
    }
  }
};

const checkPartyIdNa = (payload, partyKey, checks) => {
  const party = partyOf(payload, partyKey);
  const schemes = (party.PartyIdentification || []).map((entry) => entry?.ID?.[0]?.schemeID);
  checks.push(check(
    `Invoice.${partyKey}.Party.PartyIdentification#schemes`,
    'TIN, primary, SST, TTX',
    schemes.join(', '),
    schemes[0] === 'TIN'
      && ['BRN', 'NRIC', 'PASSPORT', 'ARMY'].includes(schemes[1])
      && schemes.includes('SST')
      && schemes.includes('TTX')
  ));
  checks.push(check(
    `Invoice.${partyKey}.Party.PartyIdentification[SST]._`,
    'NA',
    schemeValue(party, 'SST'),
    schemeValue(party, 'SST') === 'NA'
  ));
  checks.push(check(
    `Invoice.${partyKey}.Party.PartyIdentification[TTX]._`,
    'NA',
    schemeValue(party, 'TTX'),
    schemeValue(party, 'TTX') === 'NA'
  ));
};

const fullSampleChecks = (payload, sample) => {
  const checks = [];
  const invoice = invoiceOf(payload);
  const sampleInvoice = invoiceOf(sample);

  walkKeyOrder(payload, sample, '$', checks);

  checks.push(check(
    '$.#rootKeys',
    '_D, _A, _B, Invoice',
    Object.keys(payload || {}).join(', '),
    JSON.stringify(Object.keys(payload || {})) === JSON.stringify(['_D', '_A', '_B', 'Invoice'])
  ));

  const partyTaxPaths = collectPaths(payload, (value, current) => (
    current.endsWith('.PartyTaxScheme') || current.endsWith('.PartyTaxScheme[0]')
  ));
  checks.push(check(
    'Invoice.*.PartyTaxScheme',
    'omitted',
    partyTaxPaths.length ? partyTaxPaths.join(', ') : 'omitted',
    partyTaxPaths.length === 0
  ));

  checkPartyIdNa(payload, 'AccountingSupplierParty', checks);
  checkPartyIdNa(payload, 'AccountingCustomerParty', checks);

  const buyerKeys = Object.keys(partyOf(payload, 'AccountingCustomerParty'));
  checks.push(check(
    'Invoice.AccountingCustomerParty.Party#childOrder',
    'PostalAddress, PartyLegalEntity, PartyIdentification, Contact',
    buyerKeys.join(', '),
    buyerKeys.join('|') === 'PostalAddress|PartyLegalEntity|PartyIdentification|Contact'
  ));

  const supplierPartyKeys = Object.keys(partyOf(payload, 'AccountingSupplierParty'));
  checks.push(check(
    'Invoice.AccountingSupplierParty.Party#childOrder',
    'IndustryClassificationCode, PartyIdentification, PostalAddress, PartyLegalEntity, Contact',
    supplierPartyKeys.join(', '),
    supplierPartyKeys.join('|')
      === 'IndustryClassificationCode|PartyIdentification|PostalAddress|PartyLegalEntity|Contact'
  ));

  const industry = partyOf(payload, 'AccountingSupplierParty').IndustryClassificationCode?.[0];
  checks.push(check(
    'Invoice.AccountingSupplierParty.Party.IndustryClassificationCode.name',
    'non-empty business activity',
    industry?.name,
    Boolean(industry?.name)
  ));

  const adr = invoice.AdditionalDocumentReference || [];
  const incoterms = adr[adr.length - 1];
  const incotermsKeys = incoterms ? Object.keys(incoterms) : [];
  checks.push(check(
    'Invoice.AdditionalDocumentReference[Incoterms]#keys',
    'ID',
    incotermsKeys.join(', '),
    incotermsKeys.length === 1 && incotermsKeys[0] === 'ID' && incoterms?.ID?.[0]?._ === 'CIF'
  ));
  checks.push(check(
    'Invoice.AdditionalDocumentReference[Incoterms].DocumentType',
    'omitted',
    incoterms?.DocumentType ?? 'omitted',
    incoterms?.DocumentType === undefined
  ));

  const invoiceKeys = Object.keys(invoice);
  checks.push(check(
    'Invoice.TaxExchangeRate',
    'omitted for MYR',
    invoice.TaxExchangeRate ?? 'omitted',
    invoice.TaxExchangeRate === undefined
      && invoiceKeys.indexOf('TaxCurrencyCode') >= 0
  ));

  const lineSubtotal = invoice.InvoiceLine?.[0]?.TaxTotal?.[0]?.TaxSubtotal?.[0] || {};
  const lineSubtotalKeys = Object.keys(lineSubtotal);
  checks.push(check(
    'Invoice.InvoiceLine[0].TaxTotal.TaxSubtotal#PercentSibling',
    'Percent then TaxCategory as siblings',
    lineSubtotalKeys.join(', '),
    lineSubtotalKeys.includes('Percent')
      && lineSubtotalKeys.includes('TaxCategory')
      && lineSubtotalKeys.indexOf('Percent') < lineSubtotalKeys.indexOf('TaxCategory')
      && lineSubtotal.TaxCategory?.[0]?.Percent === undefined
  ));

  const headerSubtotal = invoice.TaxTotal?.[0]?.TaxSubtotal?.[0] || {};
  checks.push(check(
    'Invoice.TaxTotal.TaxSubtotal.Percent',
    'omitted at invoice level',
    headerSubtotal.Percent ?? 'omitted',
    headerSubtotal.Percent === undefined
  ));

  const originCode = invoice.InvoiceLine?.[0]?.Item?.[0]?.OriginCountry?.[0]?.IdentificationCode?.[0];
  checks.push(check(
    'Invoice.InvoiceLine[0].Item.OriginCountry.IdentificationCode#keys',
    '_ only',
    originCode ? Object.keys(originCode).join(', ') : 'missing',
    originCode && Object.keys(originCode).join('|') === '_' && originCode._ === 'MYS'
  ));

  const classifications = invoice.InvoiceLine?.[0]?.Item?.[0]?.CommodityClassification || [];
  const listIds = classifications.map((entry) => entry?.ItemClassificationCode?.[0]?.listID);
  checks.push(check(
    'Invoice.InvoiceLine[0].Item.CommodityClassification#order',
    'PTC then CLASS',
    listIds.join(', '),
    listIds[0] === 'PTC' && listIds[1] === 'CLASS'
  ));

  const billingAdr = invoice.BillingReference
    ?.find((entry) => entry.AdditionalDocumentReference)?.AdditionalDocumentReference?.[0]?.ID?.[0]?._;
  checks.push(check(
    'Invoice.BillingReference.AdditionalDocumentReference.ID',
    'E12345678912',
    billingAdr,
    billingAdr === 'E12345678912'
  ));

  const shipmentId = invoice.Delivery?.[0]?.Shipment?.[0]?.ID?.[0]?._;
  checks.push(check(
    'Invoice.Delivery.Shipment.ID',
    '1234',
    shipmentId,
    shipmentId === '1234'
  ));

  if (sampleInvoice) {
    checks.push(check(
      'sampleOracle.loaded',
      'Invoice v1.0 sample present',
      Boolean(sampleInvoice.ID),
      Boolean(sampleInvoice.ID)
    ));
  }

  return checks;
};

const errorChecks = (error, expectedCode) => ([
  check('error.name', 'LhdnMappingError', error?.name, error?.name === 'LhdnMappingError'),
  check('error.code', expectedCode, error?.code, error?.code === expectedCode),
  check(
    'error instanceof LhdnMappingError',
    true,
    error instanceof LhdnMappingError,
    error instanceof LhdnMappingError
  )
]);

const billRefChecks = (payload) => {
  const invoice = invoiceOf(payload);
  const billingIds = (invoice.BillingReference || [])
    .flatMap((entry) => entry.AdditionalDocumentReference || [])
    .map((ref) => ref?.ID?.[0]?._);
  const invoiceAdrIds = (invoice.AdditionalDocumentReference || [])
    .map((ref) => ref?.ID?.[0]?._);
  return [
    check(
      'Invoice.BillingReference.AdditionalDocumentReference.ID',
      LONG_BILL_REF,
      billingIds[0],
      billingIds.includes(LONG_BILL_REF)
    ),
    check(
      'Invoice.AdditionalDocumentReference',
      'must not contain the billing reference',
      invoiceAdrIds.join(', ') || 'omitted',
      !invoiceAdrIds.includes(LONG_BILL_REF)
    )
  ];
};

const foreignCurrencyChecks = (payload) => {
  const invoice = invoiceOf(payload);
  const keys = Object.keys(invoice);
  const taxCurrencyIdx = keys.indexOf('TaxCurrencyCode');
  const taxExIdx = keys.indexOf('TaxExchangeRate');
  const rate = invoice.TaxExchangeRate?.[0] || {};
  return [
    check(
      'Invoice.TaxExchangeRate#position',
      'immediately after TaxCurrencyCode',
      `TaxCurrencyCode@${taxCurrencyIdx}, TaxExchangeRate@${taxExIdx}`,
      taxCurrencyIdx >= 0 && taxExIdx === taxCurrencyIdx + 1
    ),
    check(
      'Invoice.TaxExchangeRate.SourceCurrencyCode',
      'USD',
      rate.SourceCurrencyCode?.[0]?._,
      rate.SourceCurrencyCode?.[0]?._ === 'USD'
    ),
    check(
      'Invoice.TaxExchangeRate.TargetCurrencyCode',
      'MYR',
      rate.TargetCurrencyCode?.[0]?._,
      rate.TargetCurrencyCode?.[0]?._ === 'MYR'
    )
  ];
};

const optionalOmittedChecks = (payload) => {
  const invoice = invoiceOf(payload);
  return ['InvoicePeriod', 'PaymentMeans', 'PrepaidPayment', 'Delivery'].map((key) => (
    check(
      `Invoice.${key}`,
      'omitted when empty',
      invoice[key] ?? 'omitted',
      invoice[key] === undefined
    )
  ));
};

const deliveryWithoutShipmentChecks = (payload) => {
  const invoice = invoiceOf(payload);
  const delivery = invoice.Delivery?.[0];
  return [
    check(
      'Invoice.Delivery',
      'present',
      delivery ? 'present' : 'omitted',
      Boolean(delivery)
    ),
    check(
      'Invoice.Delivery.Shipment',
      'omitted',
      delivery?.Shipment ?? 'omitted',
      delivery?.Shipment === undefined
    )
  ];
};

const foreignMsicChecks = (payload) => {
  const industry = partyOf(payload, 'AccountingSupplierParty').IndustryClassificationCode?.[0];
  return [
    check(
      'Invoice.AccountingSupplierParty.Party.IndustryClassificationCode._',
      '00000',
      industry?._,
      industry?._ === '00000'
    ),
    check(
      'Invoice.AccountingSupplierParty.Party.IndustryClassificationCode.name',
      'NOT APPLICABLE',
      industry?.name,
      industry?.name === 'NOT APPLICABLE'
    )
  ];
};

const foreignAddressChecks = (payload) => {
  const address = partyOf(payload, 'AccountingSupplierParty').PostalAddress?.[0] || {};
  const keys = Object.keys(address);
  return [
    check(
      'Invoice.AccountingSupplierParty.Party.PostalAddress#keyOrder',
      'CityName, PostalZone, CountrySubentityCode, AddressLine, Country',
      keys.join(', '),
      keys.join('|') === 'CityName|PostalZone|CountrySubentityCode|AddressLine|Country'
    ),
    check(
      'Invoice.AccountingSupplierParty.Party.PostalAddress.CityName',
      'NA',
      address.CityName?.[0]?._,
      address.CityName?.[0]?._ === 'NA'
    ),
    check(
      'Invoice.AccountingSupplierParty.Party.PostalAddress.PostalZone',
      'NA',
      address.PostalZone?.[0]?._,
      address.PostalZone?.[0]?._ === 'NA'
    ),
    check(
      'Invoice.AccountingSupplierParty.Party.PostalAddress.CountrySubentityCode',
      '17',
      address.CountrySubentityCode?.[0]?._,
      address.CountrySubentityCode?.[0]?._ === '17'
    ),
    check(
      'Invoice.AccountingSupplierParty.Party.PostalAddress.Country',
      'SGP',
      address.Country?.[0]?.IdentificationCode?.[0]?._,
      address.Country?.[0]?.IdentificationCode?.[0]?._ === 'SGP'
    )
  ];
};

const usdOmitZeroAllowanceChecks = (payload) => {
  const invoice = invoiceOf(payload);
  const keys = Object.keys(invoice);
  const taxCurrencyIdx = keys.indexOf('TaxCurrencyCode');
  const taxExIdx = keys.indexOf('TaxExchangeRate');
  return [
    check(
      'Invoice.AllowanceCharge',
      'omitted when amount is 0',
      invoice.AllowanceCharge ?? 'omitted',
      invoice.AllowanceCharge === undefined
    ),
    check(
      'Invoice.TaxExchangeRate#position',
      'immediately after TaxCurrencyCode',
      `TaxCurrencyCode@${taxCurrencyIdx}, TaxExchangeRate@${taxExIdx}`,
      taxCurrencyIdx >= 0 && taxExIdx === taxCurrencyIdx + 1
    )
  ];
};

const CASES = [
  {
    id: 'full-sample-shape',
    expectError: false,
    input: baseProcessedDoc(),
    checks: (payload, sample) => fullSampleChecks(payload, sample)
  },
  {
    id: 'foreign-msic-00000',
    expectError: false,
    input: withDoc((doc) => {
      doc.header.invoiceNo = 'FOREIGN-MSIC-00000';
      doc.supplier.industryClassificationCode = '00000';
      doc.supplier.industryName = 'NOT APPLICABLE';
      doc.supplier.companyIndustry = 'Wholesale of computer hardware, software and peripherals';
    }),
    checks: (payload) => foreignMsicChecks(payload)
  },
  {
    id: 'cf701-missing-activity',
    expectError: 'CF701',
    input: withDoc((doc) => {
      doc.header.invoiceNo = 'CF701-MISSING-ACTIVITY';
      doc.supplier.industryName = '';
      doc.supplier.industryClassificationCode = '';
      doc.supplier.companyIndustry = '';
    })
  },
  {
    id: 'foreign-address-sgp',
    expectError: false,
    input: withDoc((doc) => {
      doc.header.invoiceNo = 'FOREIGN-ADDRESS-SGP';
      doc.supplier.industryClassificationCode = '00000';
      doc.supplier.industryName = 'NOT APPLICABLE';
      doc.supplier.address = {
        line: '123 Tech Park',
        city: 'NA',
        postcode: 'NA',
        state: '',
        country: 'SGP'
      };
    }),
    checks: (payload) => foreignAddressChecks(payload)
  },
  {
    id: 'usd-omit-zero-allowance',
    expectError: false,
    input: withDoc((doc) => {
      doc.header.invoiceNo = 'USD-OMIT-ZERO-ALLOWANCE';
      doc.header.documentCurrencyCode = 'USD';
      doc.header.currency = 'USD';
      doc.header.taxCurrencyCode = 'MYR';
      doc.header.exchangeRate = 4.72;
      doc.allowanceCharge = {
        indicator: false,
        reason: 'NA',
        amount: 0
      };
    }),
    checks: (payload) => usdOmitZeroAllowanceChecks(payload)
  },
  {
    id: 'cf417-long-incoterms',
    expectError: 'CF417',
    input: withDoc((doc) => {
      doc.header.invoiceNo = 'CF417-LONG-INCOTERMS';
      doc.header.documentReference.billingReference = '';
      doc.header.documentReference.additionalRefs = [
        { id: 'FOBX', incoterms: true }
      ];
      doc.header.documentReference.invalidIncoterms = 'FOBX';
    })
  },
  {
    id: 'bill-ref-not-incoterms',
    expectError: false,
    input: withDoc((doc) => {
      doc.header.invoiceNo = 'BILL-REF-NOT-INCOTERMS';
      doc.header.documentReference.billingReference = LONG_BILL_REF;
      doc.header.documentReference.additionalRefs = [];
      doc.header.documentReference.invalidIncoterms = null;
    }),
    checks: (payload) => billRefChecks(payload)
  },
  {
    id: 'foreign-currency',
    expectError: false,
    input: withDoc((doc) => {
      doc.header.invoiceNo = 'FOREIGN-CURRENCY-USD';
      doc.header.documentCurrencyCode = 'USD';
      doc.header.currency = 'USD';
      doc.header.taxCurrencyCode = 'MYR';
      doc.header.exchangeRate = 4.72;
    }),
    checks: (payload) => foreignCurrencyChecks(payload)
  },
  {
    id: 'optional-omitted',
    expectError: false,
    input: withDoc((doc) => {
      doc.header.invoiceNo = 'OPTIONAL-OMITTED';
      doc.header.invoicePeriod = { startDate: '', endDate: '', description: '' };
      doc.header.documentReference.billingReference = '';
      doc.header.documentReference.additionalRefs = [];
      doc.delivery = {
        name: 'NA',
        identifications: [],
        address: malaysianAddress()
      };
      doc.payment = {
        paymentMeansCode: '',
        payeeFinancialAccount: '',
        paymentTerms: '',
        prepaidPayment: { id: '', amount: 0, date: null, time: null }
      };
    }),
    checks: (payload) => optionalOmittedChecks(payload)
  },
  {
    id: 'delivery-without-shipment',
    expectError: false,
    input: withDoc((doc) => {
      doc.header.invoiceNo = 'DELIVERY-NO-SHIPMENT';
      doc.delivery.shipment = {
        id: '',
        freightAllowanceCharge: {
          indicator: false,
          reason: '',
          amount: ''
        }
      };
    }),
    checks: (payload) => deliveryWithoutShipmentChecks(payload)
  }
];

const writeJson = (filePath, data) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const serializeError = (error) => ({
  name: error?.name || 'Error',
  code: error?.code || null,
  message: error?.message || String(error),
  target: error?.target || null,
  propertyPath: error?.propertyPath || null
});

const runCase = (testCase, sample) => {
  const caseDir = path.join(OUT_DIR, testCase.id);
  writeJson(path.join(caseDir, 'input.json'), [testCase.input]);

  let payload = null;
  let mappingError = null;
  try {
    payload = mapToLHDNFormat([testCase.input], '1.0');
  } catch (error) {
    mappingError = error;
  }

  let checks;
  if (testCase.expectError) {
    checks = errorChecks(mappingError, testCase.expectError);
    if (payload) {
      checks.push(check('payload', 'must not be produced', 'payload present', false));
    }
  } else if (mappingError) {
    checks = [
      check('mapping', 'success', serializeError(mappingError), false),
      ...errorChecks(mappingError, testCase.expectError || 'none')
    ];
  } else {
    checks = testCase.checks(payload, sample);
  }

  if (mappingError) {
    writeJson(path.join(caseDir, 'error.json'), serializeError(mappingError));
  } else {
    writeJson(path.join(caseDir, 'payload.json'), payload);
  }
  writeJson(path.join(caseDir, 'checks.json'), checks);

  const failed = checks.filter((item) => !item.pass);
  return {
    id: testCase.id,
    pass: failed.length === 0,
    checkCount: checks.length,
    failedCount: failed.length,
    failed,
    error: mappingError ? serializeError(mappingError) : null,
    files: {
      input: `logs/lhdn-review/${testCase.id}/input.json`,
      payload: mappingError
        ? `logs/lhdn-review/${testCase.id}/error.json`
        : `logs/lhdn-review/${testCase.id}/payload.json`,
      checks: `logs/lhdn-review/${testCase.id}/checks.json`
    }
  };
};

const toMd = (results) => {
  const passed = results.filter((item) => item.pass).length;
  const failed = results.length - passed;
  const lines = [
    '# LHDN mapping review',
    '',
    `Shape oracle: [Invoice v1.0 sample](${SAMPLE_URL}).`,
    '',
    `**${passed} passed**, **${failed} failed** across ${results.length} cases.`,
    '',
    '| Case | Result | Checks | Files |',
    '| --- | --- | --- | --- |'
  ];

  results.forEach((item) => {
    const status = item.pass ? 'PASS' : 'FAIL';
    const files = `[input](${item.id}/input.json) · [${item.error ? 'error' : 'payload'}](${item.id}/${item.error ? 'error' : 'payload'}.json) · [checks](${item.id}/checks.json)`;
    lines.push(
      `| ${item.id} | ${status} | ${item.checkCount - item.failedCount}/${item.checkCount} | ${files} |`
    );
  });

  const failing = results.filter((item) => !item.pass);
  if (failing.length) {
    lines.push('', '## Failing checks', '');
    failing.forEach((item) => {
      lines.push(`### ${item.id}`, '');
      item.failed.forEach((entry) => {
        lines.push(`- \`${entry.path}\``);
        lines.push(`  - expected: ${JSON.stringify(entry.expected)}`);
        lines.push(`  - actual: ${JSON.stringify(entry.actual)}`);
      });
      lines.push('');
    });
  }

  return `${lines.join('\n')}\n`;
};

const main = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sample = await loadOfficialSample();
  const results = CASES.map((testCase) => runCase(testCase, sample));
  const summary = {
    generatedAt: new Date().toISOString(),
    sampleUrl: SAMPLE_URL,
    passed: results.filter((item) => item.pass).length,
    failed: results.filter((item) => !item.pass).length,
    cases: results
  };
  writeJson(path.join(OUT_DIR, 'summary.json'), summary);
  fs.writeFileSync(path.join(OUT_DIR, 'SUMMARY.md'), toMd(results), 'utf8');

  console.log(`Wrote ${path.join(OUT_DIR, 'SUMMARY.md')}`);
  console.log(`Passed ${summary.passed} / ${results.length}`);
  results.forEach((item) => {
    const mark = item.pass ? 'PASS' : 'FAIL';
    console.log(`  ${mark} ${item.id} (${item.checkCount - item.failedCount}/${item.checkCount})`);
    item.failed.forEach((entry) => {
      console.log(`    - ${entry.path}: expected ${JSON.stringify(entry.expected)} actual ${JSON.stringify(entry.actual)}`);
    });
  });

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
