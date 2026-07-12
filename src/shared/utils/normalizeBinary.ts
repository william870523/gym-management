
export const normalizeBinary = (value: unknown): Buffer | null | undefined => {
    if (value === null || value === undefined) return value as null | undefined;
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === "string") {
        if (!value.trim()) return null;
        // Sanitize: remove data URI prefix, spaces, and fix JSON escapes
        let sanitized = value.trim();
        if (sanitized.includes(',')) sanitized = sanitized.split(',').pop() || "";
        sanitized = sanitized.replace(/\\/g, "").replace(/\s/g, "");

        try {
            return Buffer.from(sanitized, "base64");
        } catch (e) {
            console.error("Error decoding base64:", e);
            return null; // or undefined
        }
    }
    if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
        return Buffer.from(value);
    }
    if (typeof value === "object" && value !== null) {
        const asBuffer = value as { type?: string; data?: number[] };
        if (asBuffer.type === "Buffer" && Array.isArray(asBuffer.data)) {
            return Buffer.from(asBuffer.data);
        }
    }
    return undefined;
};
