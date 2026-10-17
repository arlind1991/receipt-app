// Shapes shared by the GardenWow API routes and the browser. Keep secrets out of here.

export type GardenWowClient = {
  id: string;
  name: string;
  organisationName: string | null;
  addressLine1: string | null;
  postcode: string | null;
};

export type GardenWowVisit = {
  id: string;
  date: string;
  slot: string | null;
  status: string | null;
  serviceLabel: string | null;
  address: string | null;
};

export type GardenWowReceiptLink = {
  external_id: string;
  target_client_id: string;
  target_client_name: string | null;
  target_visit_id: string | null;
  target_visit_label: string | null;
  sent_at: string;
};

export type GardenWowSendInput = {
  clientId: string;
  clientName: string | null;
  visitId: string | null;
  visitLabel: string | null;
};
