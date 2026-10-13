import { describe, expect, it } from "vitest";
import { activeHref } from "@/components/side-nav";

describe("menu highlighting", () => {
  const items = [
    { href: "/admin", label: "Dashboard", exact: true },
    { href: "/admin/products", label: "Products" },
    { href: "/admin/products/locations", label: "Locations" },
    { href: "/admin/orders", label: "Orders" },
  ];
  it("picks the most specific menu entry for the page", () => {
    expect(activeHref("/admin", items)).toBe("/admin");
    expect(activeHref("/admin/products", items)).toBe("/admin/products");
    expect(activeHref("/admin/products/0b6c", items)).toBe("/admin/products");
    expect(activeHref("/admin/products/locations/x", items)).toBe("/admin/products/locations");
  });
  it("never highlights the dashboard for other pages, nor partial word matches", () => {
    expect(activeHref("/admin/notifications", items)).toBeNull();
    expect(activeHref("/admin/ordersx", items)).toBeNull();
  });
});
