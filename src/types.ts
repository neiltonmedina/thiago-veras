export type House = {
  code: string;
  name: string;
  city: string;
  bedrooms: number;
  capacity: number;
  amenities: string[];
  dailyPrice: number;
  weekendPrice?: number;
  description: string;
  photos: string[];
  video?: string;
  mapsUrl?: string;
  keywords: string[];
};

export type IncomingMessage = {
  from: string;
  text: string;
  timestamp: Date;
};

export type ConversationState =
  | { step: 'idle' }
  | { step: 'awaiting_house_choice' }
  | { step: 'showing_house'; houseCode: string }
  | { step: 'awaiting_dates'; houseCode: string }
  | { step: 'confirming_reservation'; houseCode: string; checkInIso: string; checkOutIso: string; totalCents: number; nights: number }
  | { step: 'awaiting_client_data'; houseCode: string; checkInIso: string; checkOutIso: string; totalCents: number; nights: number }
  | { step: 'reservation_pending'; reservationId: number }
  | { step: 'handoff_human' };
