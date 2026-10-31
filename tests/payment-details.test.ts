import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, paymentMethods } from "@/server/modules/settings";

describe("payment details on invoices", () => {
  it("list bank, MTN MoMo and Telecel Cash in order, and skip an account without its number", () => {
    const all = paymentMethods(DEFAULT_SETTINGS);
    expect(all.map((m) => m.label)).toEqual(["Bank transfer", "MTN MoMo", "Telecel Cash"]);
    expect(all[0]!.lines).toContainEqual(["Account number", "0341182786"]);
    expect(all[1]!.lines).toContainEqual(["Merchant ID", "328018"]);
    expect(all[2]!.lines).toContainEqual(["Till number", "464633"]);
    const noTelecel = paymentMethods({ ...DEFAULT_SETTINGS, telecelTillNumber: "", bankBranch: "" });
    expect(noTelecel.map((m) => m.label)).toEqual(["Bank transfer", "MTN MoMo"]);
    expect(noTelecel[0]!.lines.map(([k]) => k)).not.toContain("Branch");
  });
});
