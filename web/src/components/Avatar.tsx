import { useApp } from '../store';
import { nickColor, initials } from '../chat/format';

/**
 * Renders a member's avatar: their Circles profile picture if resolved,
 * otherwise colored initials from the nick. `name` similarly prefers the
 * Circles username over the raw nick.
 */
export function Avatar({ nick, size = 32 }: { nick: string; size?: number }) {
  const profile = useApp((s) => s.profiles[nick]);
  const px = `${size}px`;
  if (profile?.avatar) {
    return (
      <img
        src={profile.avatar}
        alt={profile.displayName ?? nick}
        className="shrink-0 rounded-full object-cover"
        style={{ width: px, height: px }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-bg"
      style={{ width: px, height: px, background: nickColor(nick), fontSize: size * 0.36 }}
    >
      {initials(nick)}
    </div>
  );
}

/** Display name for a nick: Circles username if known, else the nick itself. */
export function useDisplayName(nick: string): string {
  const profile = useApp((s) => s.profiles[nick]);
  return profile?.displayName || nick;
}
