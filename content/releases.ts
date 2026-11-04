export type ReleaseKind = 'feature' | 'improvement' | 'fix';

export interface ReleaseNote {
  version: string;
  date: string;
  feature?: string[];
  improvement?: string[];
  fix?: string[];
}

/**
 * End-user release notes. Same-day notes stay on one version.
 * Core submission changes get their own version.
 * Order within each version: feature, improvement, fix.
 */
export const releases: ReleaseNote[] = [
  {
    version: '1.3.4',
    date: '04.11.26',
    fix: [
      'Credit notes, debit notes, and refund notes now keep the link to the original invoice, including invoices that were never issued in MyInvois',
      'Those notes are held back before sending when the original invoice number is missing'
    ]
  }
];
