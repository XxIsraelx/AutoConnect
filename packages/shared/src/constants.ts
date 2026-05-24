export const USER_ROLES = [
  'super_admin',
  'tenant_admin',
  'manager',
  'salesperson',
  'customer',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const VEHICLE_STATUSES = [
  'available',
  'reserved',
  'sold',
  'in_maintenance',
  'archived',
] as const;

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'negotiating',
  'won',
  'lost',
  'archived',
] as const;

export const APPOINTMENT_TYPES = [
  'test_drive',
  'evaluation',
  'in_person',
  'online',
  'delivery',
  'service',
] as const;

export const TENANT_CONTEXT_HEADER = 'x-tenant-id';
