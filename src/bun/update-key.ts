// The Ed25519 public key that signs the desktop's updates (desktop#456, update-manifest.ts), its 32 raw bytes in base64.
// The release workflow signs with the private half, the repository secret DESKTOP_UPDATE_SIGNING_KEY; a copy of it is
// kept offline. A new key reaches installed apps only through an update signed with this one.
export const UPDATE_PUBLIC_KEY = "v2m2kYp+DKIjUEBoIwbWBKamZhJPXjZNpsHqZBAWNAo=";
