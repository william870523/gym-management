export function serialize(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof Date) return obj;
    if (typeof obj === 'bigint') return Number(obj);
    if (obj instanceof Uint8Array) return Buffer.from(obj);
    if (Buffer.isBuffer(obj)) return obj;
    if (Array.isArray(obj)) return obj.map(serialize);
    if (typeof obj === 'object') {
        const newObj: any = {};
        for (const key of Object.keys(obj)) {
            newObj[key] = serialize(obj[key]);
        }
        return newObj;
    }
    return obj;
}
