"""Pydantic request/response models — spec §5."""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

Kind = Literal["restaurant", "bar", "cafe"]
Budget = Literal["$", "$$", "$$$", "$$$$"]
ReactionType = Literal["oink", "shame"]


# --- Users ----------------------------------------------------------------

class UserPublic(BaseModel):
    id: str
    username: str
    display_name: str
    pig_avatar_config: dict
    places_logged: int = 0
    # Places this person put on the map first. Adding a place auto-oinks it, so
    # an OG oink is the moment somewhere entered the group's world — worth
    # counting even when somebody else later writes the place up.
    og_oinks: int = 0
    # What the group made of those places: oinks and shames left by everyone
    # else on the places this person put on the map. The pigsty's throne and its
    # shame enclosure are decided on these two numbers.
    og_oinks_received: int = 0
    og_shames_received: int = 0
    # Last time they logged a place. The pig loses a tier per idle week, so the
    # client needs the timestamp rather than just the count (spec §9.1).
    last_logged_at: Optional[datetime] = None
    # When they turned up. The pigsty's roster sorts on it.
    joined_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SignupRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=6, max_length=200)
    display_name: str = Field(min_length=1, max_length=60)

    @field_validator("username")
    @classmethod
    def normalise_username(cls, v: str) -> str:
        v = v.strip().lower()
        if not v.replace("_", "").replace("-", "").isalnum():
            raise ValueError("username may only contain letters, numbers, - and _")
        return v


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


class UpdateMeRequest(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    pig_avatar_config: Optional[dict] = None


# --- Restaurants ----------------------------------------------------------

class RestaurantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Kind
    category: List[str] = []
    budget: Budget
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    # Optional — a place can be added by dropping a pin or searching by name.
    google_maps_url: Optional[str] = None
    google_place_id: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    area: Optional[str] = None
    postcode: Optional[str] = None


class RestaurantUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    kind: Optional[Kind] = None
    category: Optional[List[str]] = None
    budget: Optional[Budget] = None
    address: Optional[str] = None
    city: Optional[str] = None
    area: Optional[str] = None
    postcode: Optional[str] = None


class ImageOut(BaseModel):
    id: str
    url: str
    uploaded_by: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ReplyOut(BaseModel):
    id: str
    user: UserPublic
    body: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateReplyRequest(BaseModel):
    body: str = Field(min_length=1, max_length=600)


class RestaurantSummary(BaseModel):
    """Shape used by map pins and the discover list (spec §6.3)."""

    id: str
    name: str
    kind: Kind
    category: List[str]
    budget: Budget
    city: Optional[str]
    area: Optional[str]
    postcode: Optional[str] = None
    lat: float
    lng: float
    cover_image_url: Optional[str]
    # An actual upload, if anyone has added one. Kept apart from
    # `cover_image_url`, which folds uploads and the auto-sourced photo into one
    # field and so can't say which it's holding — and the client needs to know,
    # because somebody's own photo of a place beats a stock listing shot.
    uploaded_photo_url: Optional[str] = None
    google_maps_url: Optional[str]
    # Present when the place came from Google; the client uses it to ask for the
    # Maps listing photo, which leads the gallery ahead of anyone's own shots.
    google_place_id: Optional[str] = None
    recommenders: List[UserPublic]
    recommender_count: int
    # Who shamed it — the map pin and the pin sheet show these faces alongside
    # the endorsers, so a divisive place reads as divisive rather than unanimous.
    shamers: List[UserPublic] = []
    shame_count: int
    # True when the only signal on this place is shame — pin renders greyed out
    shamed_only: bool
    # Whether the viewer has been here: oinked, written it up, shamed it, or put
    # it on the map. Lets the map separate the places you know from the ones you
    # don't (spec §6.3).
    logged_by_me: bool = False
    # Whether the viewer put this place on the map. Adding is an endorsement, so
    # they can't then shame it — shame is what everyone else gets to say.
    added_by_me: bool = False


class RecommendationOut(BaseModel):
    id: str
    user: UserPublic
    review_text: str
    recommended_dishes: List[str]
    images: List[ImageOut] = []
    # The whole thread, oldest first. Small by nature — a friend group arguing
    # about one restaurant, not a comment section — so it ships with the review
    # rather than behind another request.
    replies: List[ReplyOut] = []
    created_at: datetime
    updated_at: datetime


class RestaurantDetail(RestaurantSummary):
    address: Optional[str]
    images: List[ImageOut]
    recommendations: List[RecommendationOut]
    oink_count: int
    # Two labelled groups on the detail page (spec §6.4)
    oinked_by: List[UserPublic] = []
    shamed_by: List[UserPublic] = []
    # Current viewer's own state on this place
    my_reaction: Optional[ReactionType] = None
    my_recommendation: Optional[RecommendationOut] = None
    in_my_wishlist: bool = False


# --- Recommendations & reactions -----------------------------------------

class RecommendationCreate(BaseModel):
    review_text: str = Field(min_length=1, max_length=5000)
    recommended_dishes: List[str] = []

    @field_validator("recommended_dishes")
    @classmethod
    def clean_dishes(cls, v: List[str]) -> List[str]:
        return [d.strip() for d in v if d and d.strip()][:20]


class ReactionCreate(BaseModel):
    type: ReactionType


# --- Feed -----------------------------------------------------------------

class FeedItem(BaseModel):
    """One activity card on the home feed (spec §6.2)."""

    id: str
    activity: Literal["recommendation", "oink", "shame"]
    user: UserPublic
    restaurant: RestaurantSummary
    review_text: Optional[str] = None
    recommended_dishes: List[str] = []
    images: List[ImageOut] = []
    # Who replied and how many, for the feed's reply strip. The bodies stay off
    # the feed on purpose — the thread lives on the place page, and putting it
    # here would undo the work of making the feed quiet.
    repliers: List[UserPublic] = []
    reply_count: int = 0
    created_at: datetime


# --- Place lookup ---------------------------------------------------------

class ParseLinkRequest(BaseModel):
    url: str


class PlaceCandidate(BaseModel):
    """One result from searching a place by name."""

    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    area: Optional[str] = None
    postcode: Optional[str] = None
    lat: float
    lng: float
    # Cacheable under Google's terms, unlike photo names — so this is what gets
    # stored, and the photo is re-resolved from it on demand.
    place_id: Optional[str] = None
    # Derived from OSM tags where available, so the form can prefill.
    kind: Optional[Kind] = None
    category: List[str] = []


class ParseLinkResponse(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    area: Optional[str] = None
    postcode: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    place_id: Optional[str] = None
    kind: Optional[Kind] = None
    category: List[str] = []
    # How much we managed to resolve, so the UI can say what's still needed
    resolved: bool = False
    source: Literal["google_places", "url_parse", "none"] = "none"
