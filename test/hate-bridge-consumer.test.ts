import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("HATE-bridge/v1 consumer contract", () => {
  it("accepts the owner golden request without importing HATE domain logic", () => {
    const fixture = JSON.parse(readFileSync(resolve("fixtures/hate-bridge/v1/golden-request.json"), "utf8"));
    const schema = JSON.parse(readFileSync(resolve("contracts/hate-bridge/v1/request.consumer.schema.json"), "utf8"));
    expect(fixture.schema_version).toBe("HATE-bridge/v1");
    expect(fixture.record_type).toBe("bridge_request");
    expect(fixture.owner).toBe("shipyard-cp");
    expect(schema.properties.owner.const).toBe("shipyard-cp");
    expect(schema.required.every((field: string) => field in fixture)).toBe(true);
    expect(fixture.expected_output_types.length).toBeGreaterThan(0);
  });
});
