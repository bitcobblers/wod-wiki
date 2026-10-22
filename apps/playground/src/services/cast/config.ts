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

// ── WebRTC ICE servers ──────────────────────────────────────────────────────

export interface IceServerConfig {
	urls: string;
	username?: string;
	credential?: string;
}

export interface CastTurnEnv {
	VITE_CAST_STUN_URL?: string;
	VITE_CAST_TURN_URL?: string;
	VITE_CAST_TURN_USERNAME?: string;
	VITE_CAST_TURN_CREDENTIAL?: string;
}

/**
 * Assemble the RTCConfiguration.iceServers list.
 *
 * STUN alone only works when both peers share a routable network (same LAN,
 * no AP/client isolation). When the sender can be on a different network —
 * a phone on cellular or a guest VLAN — a TURN relay is the only way the
 * DataChannel connects. TURN is opt-in via VITE_CAST_TURN_URL; credentials
 * are required by coturn-style servers and harmless elsewhere.
 */
export function buildIceServers(env: CastTurnEnv): IceServerConfig[] {
	const servers: IceServerConfig[] = [];
	const stun = env.VITE_CAST_STUN_URL?.trim();
	servers.push({ urls: stun || 'stun:stun.l.google.com:19302' });

	const turn = env.VITE_CAST_TURN_URL?.trim();
	if (turn) {
		servers.push({
			urls: turn,
			username: env.VITE_CAST_TURN_USERNAME?.trim() || undefined,
			credential: env.VITE_CAST_TURN_CREDENTIAL?.trim() || undefined,
		});
	}
	return servers;
}

export const CAST_ICE_SERVERS = buildIceServers(import.meta.env);

