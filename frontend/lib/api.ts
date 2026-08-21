/**
 * Client for the local FastAPI backend.
 *
 * Auth rides on the httpOnly session cookie the backend sets (spec §7). Cookies
 * ignore port, so a cookie set by localhost:8000 is sent from localhost:3000 —
 * which is also how middleware.ts can gate routes without its own auth call.
 * Every request therefore needs `credentials: "include"`.
 */
import type { PigConfig } from "@/lib/pig";
import type {
  FeedItem,
  StyDetail,
  StySummary,
  ParsedLink,
  PlaceCandidate,
  PlaceDetail,
  PlaceSummary,
  ReactionType,
  User,
} from "./types";
import type { Budget } from "./pig";

const BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production" ? "/api/v1" : "http://localhost:8000/api/v1");

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, "Can't reach the API — is the backend running on :8000?");
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) detail = body.detail[0].msg;
    } catch {
      /* non-JSON error body — fall back to the status text */
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * The place's photo from its Google listing, served via our own endpoint.
 *
 * Resolved server-side on each request because Google's terms forbid storing
 * photo names. 404s when there's no key or no photo, which is the client's cue
 * to fall back to a user upload or the generated placeholder.
 */
export function googlePhotoSrc(placeId: string): string {
  return `${BASE}/restaurants/${placeId}/google-photo`;
}

export const api = {
  // --- auth ---
  signup: (username: string, password: string, display_name: string) =>
    request<{ token: string; user: User }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ username, password, display_name }),
    }),

  login: (username: string, password: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  me: () => request<User>("/auth/me"),

  logout: () => request<void>("/auth/logout", { method: "POST" }),

  // --- people ---
  users: () => request<User[]>("/users"),

  // --- the farm ---
  sties: () => request<StySummary[]>("/sties"),
  sty: (id: string) => request<StyDetail>(`/sties/${id}`),
  styMembers: (id: string) => request<User[]>(`/sties/${id}/members`),
  createSty: (body: { name: string; hut: string; ground: string; member_ids: string[] }) =>
    request<StyDetail>("/sties", { method: "POST", body: JSON.stringify(body) }),
  updateSty: (id: string, body: { name?: string; hut?: string; ground?: string }) =>
    request<StyDetail>(`/sties/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSty: (id: string) => request<void>(`/sties/${id}`, { method: "DELETE" }),
  requestToJoin: (id: string) => request<StyDetail>(`/sties/${id}/requests`, { method: "POST" }),
  decideRequest: (id: string, userId: string, decision: "approve" | "decline") =>
    request<StyDetail>(`/sties/${id}/requests/${userId}/${decision}`, { method: "POST" }),
  removeFromSty: (id: string, userId: string) =>
    request<StyDetail>(`/sties/${id}/members/${userId}`, { method: "DELETE" }),
  promoteInSty: (id: string, userId: string) =>
    request<StyDetail>(`/sties/${id}/members/${userId}/admin`, { method: "POST" }),

  // --- replies ---
  addReply: (placeId: string, recommendationId: string, body: string) =>
    request<PlaceDetail>(`/restaurants/${placeId}/recommendations/${recommendationId}/replies`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
  deleteReply: (placeId: string, recommendationId: string, replyId: string) =>
    request<PlaceDetail>(
      `/restaurants/${placeId}/recommendations/${recommendationId}/replies/${replyId}`,
      { method: "DELETE" }
    ),

  // --- feed ---
  feed: (limit = 30, offset = 0) => request<FeedItem[]>(`/feed?limit=${limit}&offset=${offset}`),

  // --- places ---
  places: (
    filters: { bbox?: string; kind?: string[]; category?: string[]; budget?: string[]; q?: string; sty?: string } = {}
  ) => {
    const params = new URLSearchParams();
    if (filters.bbox) params.set("bbox", filters.bbox);
    if (filters.q) params.set("q", filters.q);
    if (filters.sty) params.set("sty", filters.sty);
    filters.kind?.forEach((k) => params.append("kind", k));
    filters.category?.forEach((c) => params.append("category", c));
    filters.budget?.forEach((b) => params.append("budget", b));
    const qs = params.toString();
    return request<PlaceSummary[]>(`/restaurants${qs ? `?${qs}` : ""}`);
  },

  place: (id: string) => request<PlaceDetail>(`/restaurants/${id}`),

  createPlace: (payload: {
    name: string;
    kind: string;
    category: string[];
    budget: Budget;
    lat: number;
    lng: number;
    google_maps_url?: string | null;
    google_place_id?: string | null;
    address?: string | null;
    city?: string | null;
    area?: string | null;
    postcode?: string | null;
  }) => request<PlaceDetail>("/restaurants", { method: "POST", body: JSON.stringify(payload) }),

  /** Edit a place. The API refuses anyone but whoever added it. */
  updatePlace: (
    placeId: string,
    payload: {
      name?: string;
      kind?: string;
      category?: string[];
      budget?: Budget;
      address?: string | null;
      city?: string | null;
      area?: string | null;
      postcode?: string | null;
    }
  ) => request<PlaceDetail>(`/restaurants/${placeId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  }),

  parseMapsLink: (url: string) =>
    request<ParsedLink>("/places/parse-google-maps-link", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  searchPlaces: (q: string, postcode?: string, near?: { lat: number; lng: number } | null) => {
    const params = new URLSearchParams({ q });
    // Re-ranks results onto the right district — Nominatim returns the correct
    // one but doesn't prefer it.
    if (postcode?.trim()) params.set("postcode", postcode.trim());
    // Where the map is pointed, so Google prefers the nearby branch of a chain
    // over its most famous one.
    if (near) {
      params.set("lat", String(near.lat));
      params.set("lng", String(near.lng));
    }
    return request<PlaceCandidate[]>(`/places/search?${params.toString()}`);
  },

  uploadImage: (placeId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ id: string; url: string }>(`/restaurants/${placeId}/images`, {
      method: "POST",
      body: form,
    });
  },

  // --- recommendations & reactions ---
  recommend: (placeId: string, review_text: string, recommended_dishes: string[]) =>
    request<PlaceDetail>(`/restaurants/${placeId}/recommendations`, {
      method: "POST",
      body: JSON.stringify({ review_text, recommended_dishes }),
    }),

  /** Removes every signal you've left on a place — oink, write-up or shame. */
  unlog: (placeId: string) =>
    request<PlaceDetail>(`/restaurants/${placeId}/log`, { method: "DELETE" }),

  deleteRecommendation: (placeId: string) =>
    request<PlaceDetail>(`/restaurants/${placeId}/recommendations`, { method: "DELETE" }),

  react: (placeId: string, type: ReactionType) =>
    request<PlaceDetail>(`/restaurants/${placeId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ type }),
    }),

  // --- wishlist ---
  addWishlist: (placeId: string) =>
    request<PlaceDetail>(`/restaurants/${placeId}/wishlist`, { method: "POST" }),

  removeWishlist: (placeId: string) =>
    request<PlaceDetail>(`/restaurants/${placeId}/wishlist`, { method: "DELETE" }),

  wishlist: () => request<PlaceSummary[]>("/users/me/wishlist"),

  // --- users ---
  user: (identifier: string) => request<User>(`/users/${identifier}`),

  userPlaces: (identifier: string) => request<PlaceSummary[]>(`/users/${identifier}/recommendations`),

  updateMe: (payload: { display_name?: string; pig_avatar_config?: PigConfig }) =>
    request<User>("/users/me", { method: "PATCH", body: JSON.stringify(payload) }),
};
