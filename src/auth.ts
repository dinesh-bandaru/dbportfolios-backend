export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const pbkdf2 = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
    );

    const key = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256",
        },
        pbkdf2,
        256
    );

    const hashContent = new Uint8Array(key.byteLength + salt.length);
    hashContent.set(salt);
    hashContent.set(new Uint8Array(key), salt.length);

    return btoa(String.fromCharCode(...hashContent));
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const hashContent = new Uint8Array(
        atob(storedHash)
            .split("")
            .map((c) => c.charCodeAt(0))
    );

    const salt = hashContent.slice(0, 16);
    const key = hashContent.slice(16);

    const pbkdf2 = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256",
        },
        pbkdf2,
        256
    );

    const derivedKey = new Uint8Array(derivedBits);
    if (derivedKey.length !== key.length) return false;

    // Constant-time comparison to prevent timing attacks
    return crypto.subtle.timingSafeEqual(key, derivedKey);
}
