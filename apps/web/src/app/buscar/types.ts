export interface DealershipPin {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  addressLine: string | null;
  phone: string | null;
  email: string | null;
  latitude: number | null;
  longitude: number | null;
  vehiclesCount: number;
  businessHours?: unknown;
  tenant: {
    id: string;
    tradeName: string;
    logoUrl: string | null;
  };
}

export interface PublicVehicle {
  id: string;
  versionName: string | null;
  yearModel: number;
  yearMake: number;
  price: string;
  promoPrice: string | null;
  mileageKm: number;
  condition: 'new' | 'used' | 'semi_new' | 'demo';
  color: string | null;
  fuel?: string | null;
  transmission?: string | null;
  tenantId: string;
  brand: { id: string; name: string; logoUrl: string | null };
  model: { id: string; name: string; category: string | null };
  images: { url: string }[];
}

export interface SavedSearch {
  id: string;
  name: string;
  filters: Record<string, string>;
  lastViewedAt: string;
  createdAt: string;
  newCount: number;
}

export interface PublicVehicleDetail extends PublicVehicle {
  fuel: string | null;
  transmission: string | null;
  engine: string | null;
  doors: number | null;
  description: string | null;
  images: { id: string; url: string; altText: string | null; isCover: boolean; position: number }[];
}

export interface VehiclesPage {
  items: PublicVehicle[];
  total: number;
}

export interface PublicBrand {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface PublicDealer {
  id: string;
  tradeName: string;
  logoUrl: string | null;
  brandColor: string | null;
  websiteUrl: string | null;
  primaryPhone: string | null;
  branches: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    addressLine: string | null;
    addressNumber: string | null;
    phone: string | null;
    email: string | null;
    latitude: number | null;
    longitude: number | null;
  }[];
}
