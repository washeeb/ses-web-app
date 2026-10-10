import "server-only";
import { cookies } from "next/headers";
import { parseCart, type Cart } from "../modules/store";

/** The cart lives in an httpOnly cookie: variant ids and quantities only, re-priced on every read. */
export const CART_COOKIE = "ses_cart";

export async function readCart(): Promise<Cart> {
  return parseCart((await cookies()).get(CART_COOKIE)?.value);
}

export async function writeCart(cart: Cart) {
  const jar = await cookies();
  if (cart.length === 0) {
    jar.delete(CART_COOKIE);
    return;
  }
  jar.set(CART_COOKIE, JSON.stringify(cart), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86_400,
  });
}
