"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { products, productVariants } from "@/server/db/schema";
import { invalid } from "@/server/lib/errors";
import { placeStoreOrder, requestCartQuote, setCartLine } from "@/server/modules/store";
import { int, run, str, type ActionState } from "@/server/web/actions";
import { readCart, writeCart } from "@/server/web/cart";
import { clientIp, requireActor } from "@/server/web/session";

async function assertSellable(variantId: string) {
  const [row] = await getDb()
    .select({ id: productVariants.id })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(productVariants.id, variantId), eq(productVariants.active, true), eq(products.status, "active")));
  if (!row) throw invalid("That product option is not available.");
}

export async function addToCartAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const variantId = str(fd, "variantId");
    await assertSellable(variantId);
    await writeCart(setCartLine(await readCart(), variantId, int(fd, "quantity"), "add"));
    revalidatePath("/", "layout");
    return "Added to your cart.";
  });
}

export async function updateCartLineAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const quantity = str(fd, "op") === "remove" ? 0 : int(fd, "quantity");
    await writeCart(setCartLine(await readCart(), str(fd, "variantId"), quantity, "set"));
    revalidatePath("/", "layout");
    return quantity === 0 ? "Removed." : "Updated.";
  });
}

export async function placeOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("customer", "/store/cart");
  let target = "";
  const r = await run(async () => {
    const order = await placeStoreOrder(getDb(), actor, { cart: await readCart(), customerReference: str(fd, "customerReference") });
    await writeCart([]);
    target = `/portal/orders/${order.id}?placed=1`;
  });
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  redirect(target);
}

export async function cartQuoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let reference = "";
  const result = await run(async () => {
    const r = await requestCartQuote(
      getDb(),
      {
        contactName: str(fd, "contactName"),
        email: str(fd, "email"),
        phone: str(fd, "phone"),
        companyName: str(fd, "companyName"),
        message: str(fd, "message"),
        website: str(fd, "website"),
      },
      await readCart(),
      await clientIp(),
    );
    await writeCart([]);
    reference = r.number;
  });
  if (!result.ok) return result;
  // The cart is now empty, so the form disappears: show the reference on the page itself.
  revalidatePath("/", "layout");
  redirect(`/store/cart?requested=${encodeURIComponent(reference)}`);
}
