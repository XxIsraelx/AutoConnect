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
  price: string;        // Decimal serializado como string
  promoPrice: string | null;
  mileageKm: number;
  condition: 'new' | 'used' | 'semi_new' | 'demo';
  tenantId: string;
  brand: { id: string; name: string; logoUrl: string | null };
  model: { id: string; name: string; category: string };
  images: { url: string }[];
}
