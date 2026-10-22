/**
 * Cast Configuration
 *
 * Signaling flows through the Google Cast SDK custom message namespace, and
 * all workout data is exchanged directly over an RTCDataChannel (WebRTC).
 *
 * Set VITE_CAST_APP_ID in .env.local to the App ID of your registered
 * Custom Receiver at https://cast.google.com/publish.
 */

/**
 * Default Cast App ID for non-development builds.
 *
 * Dev can override this with VITE_CAST_APP_ID (for example B82FCDD8).
 */
export const DEFAULT_CAST_APP_ID = '38F01E0E';

/**
 * Google's Default Media Receiver app ID (NOT valid for custom namespaces).
 */
export const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845';

export const CAST_APP_ID = (import.meta.env.VITE_CAST_APP_ID || DEFAULT_CAST_APP_ID).trim();

export const isCustomCastAppId = (appId: string): boolean => {
	return Boolean(appId) && appId !== DEFAULT_MEDIA_RECEIVER_APP_ID;
};

export const hasCustomCastAppId = isCustomCastAppId(CAST_APP_ID);

