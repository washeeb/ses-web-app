import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-semibold text-teal-700">404</p>
      <h1 className="mt-2 text-2xl font-bold">We couldn&apos;t find that page</h1>
      <p className="mt-2 text-slate-600">It may have moved, or you may not have access to it.</p>
      <Link href="/" className="btn btn-primary mt-6">Go to the home page</Link>
    </main>
  );
}
