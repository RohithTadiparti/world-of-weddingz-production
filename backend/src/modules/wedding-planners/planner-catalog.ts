/**
 * The services a planner can offer and the kinds of wedding they can
 * specialise in, by key.
 *
 * The web client holds the same keys with their labels
 * (frontend/src/lib/planner-profile.ts). Only the keys live here: the server's
 * job is to refuse a key nobody can name, so that a listing never offers, and a
 * request never asks for, a service the other side cannot read.
 */
export const PLANNER_SERVICE_KEYS = [
  'full_planning',
  'partial_planning',
  'day_of_coordination',
  'destination_wedding',
  'venue_management',
  'decoration',
  'catering',
  'photography',
  'makeup',
  'entertainment',
  'transportation',
  'guest_management',
  'invitations',
  'budget_management',
  'timeline_management',
  'event_planning',
] as const;

export const PLANNER_SPECIALIZATION_KEYS = [
  'traditional',
  'telugu',
  'tamil',
  'north_indian',
  'christian',
  'muslim',
  'luxury',
  'destination',
  'modern',
  'intimate',
  'budget',
  'theme',
] as const;

export const MAX_PLANNER_WEDDINGS = 24;
export const MAX_WEDDING_PHOTOS = 30;
export const MAX_WEDDING_VIDEOS = 6;
export const MAX_WEDDING_EVENTS = 12;

/** Video links a profile may carry besides an uploaded file. */
export const VIDEO_HOSTS = [/^(www\.|m\.)?youtube\.com$/i, /^youtu\.be$/i, /^(www\.|player\.)?vimeo\.com$/i];
