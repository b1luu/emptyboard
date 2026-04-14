export type Term = { code: string; label: string };

export type RoomApiItem = {
  building: string;
  room: string;
  roomId: string;
  status: "open_now" | "opens_later" | "fits_window" | "closed" | string;
  freeWindow: {
    startMin?: number;
    endMin?: number;
    startLabel: string;
    endLabel: string;
  } | null;
  nextClass: { startsAtLabel: string; label: string } | null;
};

export type FreeNowResponse = {
  term: string;
  timezone: string;
  now: { day: string | null; minutes: number; weekdayLabel: string };
  campusDay: boolean;
  count: number;
  whiteboardPlaceholder?: boolean;
  rooms: RoomApiItem[];
};

export type SearchResponse = {
  term: string;
  day: string;
  window: { startMin: number; endMin: number; startLabel: string; endLabel: string };
  count: number;
  whiteboardPlaceholder?: boolean;
  rooms: RoomApiItem[];
};

export type SearchIntent = {
  raw: string;
  durationMin?: number;
  areaHint?: "geisel" | "cse" | "near_me";
  now?: boolean;
};

export type RoomRecommendation = {
  building: string;
  room: string;
  roomId: string;
  freeStartMin: number;
  freeEndMin: number;
  freeStartLabel: string;
  freeEndLabel: string;
  freeDurationMin: number;
  statusLabel: string;
  descriptor: string;
  nearbyLabel: string;
  nextClassLabel: string;
  buildingMeta: string;
  rankScore: number;
  isBest: boolean;
};

export type QuickChipId = "now" | "next30" | "oneToTwo" | "nearMe" | "nearGeisel" | "nearCse";
