/** Fixture data so `ferry ui --demo` runs without connecting to an org. */
export const DEMO_TYPES = [
  { name: 'ApexClass', inFolder: false },
  { name: 'ApexTrigger', inFolder: false },
  { name: 'CustomObject', inFolder: false },
  { name: 'LightningComponentBundle', inFolder: false },
];

export const DEMO_COMPONENTS = {
  ApexClass: [
    row('ApexClass', 'AccountController', 'A. Vaste', '2026-06-20', 'A. Vaste', '2025-01-02'),
    row('ApexClass', 'AccountController_Test', 'A. Vaste', '2026-06-20', 'A. Vaste', '2025-01-02'),
    row('ApexClass', 'LeadService', 'J. Smith', '2026-06-23', 'A. Vaste', '2024-11-15'),
    row('ApexClass', 'OrderTriggerHandler', 'B. Lee', '2026-03-11', 'B. Lee', '2026-02-01'),
    row('ApexClass', 'zUtility', 'A. Vaste', '2026-01-05', 'C. Diaz', '2023-09-30'),
  ],
  ApexTrigger: [
    row('ApexTrigger', 'AccountTrigger', 'A. Vaste', '2026-06-20', 'A. Vaste', '2025-01-02'),
    row('ApexTrigger', 'OrderTrigger', 'B. Lee', '2026-03-11', 'B. Lee', '2026-02-01'),
  ],
  CustomObject: [
    row('CustomObject', 'Invoice__c', 'A. Vaste', '2026-05-30', 'A. Vaste', '2025-07-12'),
    row('CustomObject', 'Shipment__c', 'C. Diaz', '2026-04-18', 'C. Diaz', '2025-08-01'),
  ],
  LightningComponentBundle: [
    row('LightningComponentBundle', 'invoiceList', 'A. Vaste', '2026-06-01', 'A. Vaste', '2026-06-01'),
    row('LightningComponentBundle', 'orderCard', 'J. Smith', '2026-02-22', 'J. Smith', '2026-02-22'),
  ],
};

function row(type, fullName, modBy, modDate, crBy, crDate) {
  return {
    type,
    fullName,
    lastModifiedByName: modBy,
    lastModifiedDate: `${modDate}T10:00:00.000+0000`,
    createdByName: crBy,
    createdDate: `${crDate}T10:00:00.000+0000`,
    id: '',
  };
}
