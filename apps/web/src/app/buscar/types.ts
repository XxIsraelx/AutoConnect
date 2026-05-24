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
