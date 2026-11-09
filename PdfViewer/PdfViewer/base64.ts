/**
 * Robust base64 and PDF signature validation utilities.
 * Designed to handle Power Fx JSON output, MIME line breaks, URL-safe characters,
 * missing padding, and large payloads (10+ MB) without stack overflow.
 */

// Lookup table for direct binary base64 decoding fallback
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    B64_LOOKUP[i] = 255;
}
for (let i = 0; i < B64_CHARS.length; i++) {
    B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}
B64_LOOKUP["-".charCodeAt(0)] = 62;
B64_LOOKUP["_".charCodeAt(0)] = 63;

/**
 * Direct pure-JavaScript Base64 decoding fallback.
 * Guaranteed to succeed without relying on DOM window.atob, completely immune
 * to unexpected formatting characters or browser-specific exceptions.
 */
function decodeBase64Fallback(b64: string): Uint8Array {
    const clean: number[] = [];
    for (let i = 0; i < b64.length; i++) {
        const val = B64_LOOKUP[b64.charCodeAt(i)];
        if (val !== 255) {
            clean.push(val);
        }
    }

    const byteLen = Math.floor((clean.length * 3) / 4);
    const bytes = new Uint8Array(byteLen);
    let p = 0;

    for (let i = 0; i < clean.length; i += 4) {
        const c0 = clean[i];
        const c1 = clean[i + 1] ?? 0;
        const c2 = clean[i + 2] ?? 0;
        const c3 = clean[i + 3] ?? 0;

        const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;

        if (p < byteLen) bytes[p++] = (triple >> 16) & 255;
        if (p < byteLen && i + 2 < clean.length) bytes[p++] = (triple >> 8) & 255;
        if (p < byteLen && i + 3 < clean.length) bytes[p++] = triple & 255;
    }

    return bytes.subarray(0, p);
}

/**
 * Validates whether the given byte array begins with the PDF magic header (%PDF-).
 * Accepts %PDF- at offset 0 or within the first 1024 bytes to accommodate UTF-8 BOM
 * or leading metadata comments as permitted by the PDF 1.7 specification.
 *
 * @param bytes Decoded binary bytes.
 * @returns True if valid PDF signature is detected.
 */
export function hasPdfSignature(bytes: Uint8Array): boolean {
    if (bytes.length < 5) {
        return false;
    }
    // %PDF- ASCII bytes: 0x25 (%), 0x50 (P), 0x44 (D), 0x46 (F), 0x2D (-)
    if (
        bytes[0] === 0x25 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x44 &&
        bytes[3] === 0x46 &&
        bytes[4] === 0x2D
    ) {
        return true;
    }

    // Check within the first 1024 bytes in case of leading BOM or comments
    const limit = Math.min(bytes.length - 4, 1024);
    for (let i = 1; i < limit; i++) {
        if (
            bytes[i] === 0x25 &&
            bytes[i + 1] === 0x50 &&
            bytes[i + 2] === 0x44 &&
            bytes[i + 3] === 0x46 &&
            bytes[i + 4] === 0x2D
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Strips surrounding single or double quotes, commonly emitted by
 * Power Fx `JSON(file, JSONFormat.IncludeBinaryData)`.
 */
export function stripSurroundingQuotes(input: string): string {
    let s = input.trim();
    while (
        (s.startsWith('"') && s.endsWith('"')) ||
        (s.startsWith("'") && s.endsWith("'"))
    ) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

/**
 * Converts a base64 or data URI string into a Uint8Array.
 * Handles:
 * - Data URI prefix (`data:application/pdf;base64,...`)
 * - Surrounding quotes (`"..."` or `'...'`, matched or unmatched)
 * - Percent-encoded entities (`%20`, `%2B`, etc.)
 * - MIME line breaks, spaces, tabs, and invisible Unicode whitespace (ZWS, BOM, etc.)
 * - URL-safe base64 (`-` and `_`)
 * - Missing or malformed `=` padding
 * - Large payloads (10+ MB) via chunked `atob` with direct lookup fallback
 * - Strict PDF signature validation (%PDF-)
 *
 * @param input Raw base64 string or data URI.
 * @returns Uint8Array containing binary PDF data.
 * @throws Error if input is invalid base64 or not a valid PDF.
 */
export function base64ToUint8Array(input: string): Uint8Array {
    if (!input || typeof input !== "string") {
        throw new Error("PDF source is empty or invalid.");
    }

    let s = input.trim();

    // 1. Strip leading and trailing quotes of all kinds (matched or unmatched)
    s = s.replace(/^["'`\\]+|["'`\\]+$/g, "");

    // 2. Strip data URI or MIME header if present (e.g., "data:application/pdf;base64,...")
    if (s.toLowerCase().includes("data:") || s.includes(",")) {
        const commaIndex = s.indexOf(",");
        if (commaIndex !== -1 && commaIndex < 120) {
            s = s.substring(commaIndex + 1);
        }
    }

    // Strip quotes again in case they were inside data URI quotes
    s = s.replace(/^["'`\\]+|["'`\\]+$/g, "");

    // 3. Unescape percent-encoding if present (e.g. %20, %2B, %2F)
    if (s.includes("%")) {
        try {
            s = decodeURIComponent(s);
        } catch {
            s = s
                .replace(/%20/g, " ")
                .replace(/%2B/g, "+")
                .replace(/%2F/g, "/")
                .replace(/%3D/g, "=");
        }
    }

    // 4. Normalize URL-safe characters (- -> +, _ -> /)
    s = s.replace(/-/g, "+").replace(/_/g, "/");

    // 5. Strip all non-base64 characters: spaces, newlines, tabs, zero-width spaces, quotes, control characters
    s = s.replace(/[^A-Za-z0-9+/=]/g, "");

    if (s.length === 0) {
        throw new Error("PDF base64 data is empty.");
    }

    // 6. Normalize '=' padding
    let raw = s.replace(/=+$/, "");
    raw = raw.replace(/=/g, ""); // Remove any stray '=' in the middle

    const remainder = raw.length % 4;
    if (remainder === 2) {
        s = raw + "==";
    } else if (remainder === 3) {
        s = raw + "=";
    } else if (remainder === 1) {
        // Discard 1 stray trailing character so length aligns to 4
        s = raw.slice(0, -1);
    } else {
        s = raw;
    }

    let uint8Array: Uint8Array;

    // 7. Decode: try fast chunked atob first, fall back to pure JS decoder if atob rejects
    try {
        let paddingCount = 0;
        if (s.endsWith("==")) {
            paddingCount = 2;
        } else if (s.endsWith("=")) {
            paddingCount = 1;
        }

        const totalBytes = Math.floor((s.length * 3) / 4) - paddingCount;
        uint8Array = new Uint8Array(totalBytes);

        const CHUNK_SIZE = 65536; // Must be a multiple of 4
        let outOffset = 0;

        for (let i = 0; i < s.length; i += CHUNK_SIZE) {
            const chunk = s.slice(i, i + CHUNK_SIZE);
            const binaryString = atob(chunk);
            for (let j = 0; j < binaryString.length; j++) {
                uint8Array[outOffset++] = binaryString.charCodeAt(j);
            }
        }
    } catch {
        // Safe fallback using direct lookup table
        uint8Array = decodeBase64Fallback(s);
    }

    // 8. Verify PDF magic signature
    if (!hasPdfSignature(uint8Array)) {
        throw new Error("The provided data is not a valid PDF");
    }

    return uint8Array;
}

/**
 * Converts a Uint8Array into a Base64 encoded string.
 * Uses safe chunking (8192 bytes) to completely avoid call stack size limits on large PDFs.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = "";
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
        const sub = bytes.subarray(i, Math.min(i + chunkSize, len));
        binary += String.fromCharCode.apply(null, sub as unknown as number[]);
    }
    return btoa(binary);
}
