/**
 * Cal.com data region (US vs. EU) and optional self-hosted endpoint overrides.
 *
 * For normal Cal.com builds, the app routes traffic by the user's selected
 * region. For dedicated self-hosted builds, set both of these Expo public env
 * variables and the hosted-region selection becomes irrelevant:
 *
 * - EXPO_PUBLIC_CALCOM_SELF_HOSTED_APP_URL
 * - EXPO_PUBLIC_CALCOM_SELF_HOSTED_API_V2_URL
 *
 * Example:
 *   APP URL:    https://calendar.example.com
 *   API v2 URL: https://calendar.example.com/api/v2
 *
 * Link-construction rule: never inline literal Cal.com hostnames elsewhere in
 * `apps/mobile/**`. Use the getters exported from this module.
 */

import { Platform } from "react-native";

import { generalStorage, isChromeStorageAvailable } from "./storage";

export type CalRegion = "us" | "eu";

const REGION_STORAGE_KEY = "cal_region";
const DEFAULT_REGION: CalRegion = "us";

function normalizeUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

const SELF_HOSTED_APP_URL = normalizeUrl(process.env.EXPO_PUBLIC_CALCOM_SELF_HOSTED_APP_URL);
const SELF_HOSTED_API_V2_URL = normalizeUrl(
  process.env.EXPO_PUBLIC_CALCOM_SELF_HOSTED_API_V2_URL
);

/**
 * True when this build has a complete self-hosted endpoint pair configured.
 */
export function isSelfHostedBuild(): boolean {
  return Boolean(SELF_HOSTED_APP_URL && SELF_HOSTED_API_V2_URL);
}

/**
 * Returns a configuration problem that should be surfaced to the operator.
 * We intentionally don't throw at module import time so lint/typecheck and
 * partially configured development environments remain usable.
 */
export function getSelfHostedConfigError(): string | null {
  if (Boolean(SELF_HOSTED_APP_URL) === Boolean(SELF_HOSTED_API_V2_URL)) {
    return null;
  }

  return "Self-hosted configuration is incomplete. Set both EXPO_PUBLIC_CALCOM_SELF_HOSTED_APP_URL and EXPO_PUBLIC_CALCOM_SELF_HOSTED_API_V2_URL.";
}

let currentRegion: CalRegion = DEFAULT_REGION;
const listeners = new Set<(region: CalRegion) => void>();

export function isValidRegion(value: string | null): value is CalRegion {
  return value === "us" || value === "eu";
}

function readSync(): CalRegion | null {
  if (isChromeStorageAvailable()) {
    // chrome.storage is async; caller should await preloadRegion() on startup.
    return null;
  }
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    const raw = localStorage.getItem(REGION_STORAGE_KEY);
    return isValidRegion(raw) ? raw : null;
  }
  return null;
}

const initial = readSync();
if (initial) {
  currentRegion = initial;
}

/**
 * Preload the region from persistent storage. Call once on app startup before
 * any OAuth / API call is made. On web (localStorage) this is effectively a
 * no-op because the sync read above already populated the cache.
 */
export async function preloadRegion(): Promise<CalRegion> {
  try {
    const raw = await generalStorage.getItem(REGION_STORAGE_KEY);
    if (isValidRegion(raw) && raw !== currentRegion) {
      currentRegion = raw;
      notify();
    }
  } catch {
    // Fall back to in-memory default; not worth failing app startup over.
  }
  return currentRegion;
}

// Await before calling getRegion() in async contexts that mount before AuthProvider.
export const regionPreloaded: Promise<CalRegion> = preloadRegion();

export function getRegion(): CalRegion {
  return currentRegion;
}

export async function setRegion(region: CalRegion): Promise<void> {
  if (region === currentRegion) return;
  currentRegion = region;
  notify();
  try {
    await generalStorage.setItem(REGION_STORAGE_KEY, region);
  } catch {
    // Persisting is best-effort; region stays in-memory for this session.
  }
}

/**
 * Remove the persisted region selection and reset the in-memory cache to the
 * default. Intended for logout so the next hosted Cal.com user can choose a
 * region again. Self-hosted builds continue to use their configured endpoints.
 */
export async function clearRegion(): Promise<void> {
  currentRegion = DEFAULT_REGION;
  try {
    await generalStorage.removeItem(REGION_STORAGE_KEY);
  } catch {
    // Best-effort; the in-memory cache is already reset.
  }
  notify();
}

export function subscribeRegion(listener: (region: CalRegion) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener(currentRegion);
    } catch {
      // Ignore listener errors so one bad subscriber can't break others.
    }
  }
}

/** Fully-qualified origin of the Cal.com/Cal.diy web app. */
export function getCalAppUrl(region: CalRegion = currentRegion): string {
  if (SELF_HOSTED_APP_URL) return SELF_HOSTED_APP_URL;
  return region === "eu" ? "https://app.cal.eu" : "https://app.cal.com";
}

/**
 * Base URL used by the API client before it appends `/v2`.
 *
 * The self-hosted env accepts either a full v2 URL (`.../api/v2`) or the base
 * immediately before `/v2` (`.../api`). This keeps the existing request client
 * compatible with both the hosted and self-hosted routing layouts.
 */
export function getCalApiUrl(region: CalRegion = currentRegion): string {
  if (SELF_HOSTED_API_V2_URL) {
    return SELF_HOSTED_API_V2_URL.endsWith("/v2")
      ? SELF_HOSTED_API_V2_URL.slice(0, -3)
      : SELF_HOSTED_API_V2_URL;
  }
  return region === "eu" ? "https://api.cal.eu" : "https://api.cal.com";
}

/** Fully-qualified origin used for product/marketing links. */
export function getCalWebUrl(region: CalRegion = currentRegion): string {
  if (SELF_HOSTED_APP_URL) return SELF_HOSTED_APP_URL;
  return region === "eu" ? "https://cal.eu" : "https://cal.com";
}

/** Cal.com support shortlink. */
export function getCalSupportUrl(): string {
  return "https://go.cal.com/support";
}

/** Cal.com help-docs URL. */
export function getCalHelpUrl(slug: string): string {
  const trimmed = slug.replace(/^\/+/, "");
  return `https://cal.com/help/${trimmed}`;
}

function getSelfHostedHostname(): string | null {
  if (!SELF_HOSTED_APP_URL) return null;
  try {
    return new URL(SELF_HOSTED_APP_URL).hostname;
  } catch {
    return null;
  }
}

/**
 * App hostnames recognized by browser/deep-link helpers.
 */
export const CAL_APP_HOSTNAMES: ReadonlySet<string> = new Set(
  ["app.cal.com", "app.cal.eu", getSelfHostedHostname()].filter(
    (hostname): hostname is string => Boolean(hostname)
  )
);
