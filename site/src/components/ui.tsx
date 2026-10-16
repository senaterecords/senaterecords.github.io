// Small pieces shared by the React islands.
import { ICONS, type IconName } from "../lib/icons";

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const [viewBox, body] = ICONS[name];
  const [, , w, h] = viewBox.split(" ").map(Number);
  return (
    <svg className={className ? `icon ${className}` : "icon"} width={size} height={Math.round((size * h) / w)} viewBox={viewBox}
      aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: body }} />
  );
}
