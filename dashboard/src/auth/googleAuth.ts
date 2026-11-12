/** Google sign-in with Google Identity Services (successor of gapi.auth2 used by the TGG viewer).
 *  Requests a Cloud Storage token (read, plus write so the solved table can be saved to the release folder);
 *  nothing is sent anywhere but Google. */

const GIS_SRC = "https://accounts.google.com/gsi/client";
// Storage only: no identity scopes, so the consent screen lists nothing about the user's personal info.
const SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(opts?: { prompt?: string }): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
            include_granted_scopes?: boolean;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Could not load Google Identity Services script"));
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export interface Session {
  accessToken: string;
  expiresAt: number;
}

/** Open Google's consent popup and resolve with a short-lived access token. */
export async function signIn(clientId: string): Promise<Session> {
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      include_granted_scopes: false,   // do not re-attach scopes granted to this app in the past
      callback: (r) => {
        if (r.error || !r.access_token) {
          reject(new Error(r.error_description || r.error || "Sign-in failed"));
          return;
        }
        resolve({ accessToken: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 });
      },
      error_callback: (e) => reject(new Error(e.message || e.type)),
    });
    client.requestAccessToken();
  });
}

export function signOut(session: Session | null): void {
  if (session && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(session.accessToken);
}
