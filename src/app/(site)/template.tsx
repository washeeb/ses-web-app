/** Re-mounts on every navigation, so each page fades in as it arrives (see .page-enter in globals.css). */
export default function SiteTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
