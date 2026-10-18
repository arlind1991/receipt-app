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

// What GardenWow has for a receipt. target_client_id null = Unassigned.
export type GardenWowReceiptLink = {
  external_id: string;
  target_client_id: string | null;
  target_client_name: string | null;
  target_visit_id: string | null;
  target_visit_label: string | null;
  sent_at: string;
  status: "sent" | "failed" | "removed";
  last_error: string | null;
  sent_hash: string | null;
};

// Where a receipt should go. clientId null = the Unassigned folder.
export type GardenWowTarget = {
  clientId: string | null;
  clientName: string | null;
  visitId: string | null;
  visitLabel: string | null;
};

export type GardenWowSendInput = GardenWowTarget;

export type GardenWowReceiptState = {
  link: GardenWowReceiptLink | null;
  target: GardenWowTarget;
  // Fields the platform needs before the receipt can be sent.
  missing: Array<"date" | "total" | "photo">;
};
