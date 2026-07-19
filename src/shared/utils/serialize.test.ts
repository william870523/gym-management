import { describe, expect, test } from "bun:test";
import { Prisma } from "@prisma/client";

import { serialize } from "./serialize";

describe("remote JSON serialization", () => {
    test("preserves exact decimal amounts as strings", () => {
        expect(serialize({ importe: new Prisma.Decimal("3000.25") })).toEqual({
            importe: "3000.25",
        });
    });
});
