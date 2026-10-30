import learning from '../assets/images/learning.svg?raw';
import classroom from '../assets/images/classroom.svg?raw';

/** Original platform silhouettes, redrawn as monochrome vectors that inherit the nav color. */
export default function PlatformIcon({ platform }: { platform: 'learning' | 'classroom' }) {
  const source = platform === 'learning' ? learning : classroom;
  // Trusted, bundled SVG only. Inline markup preserves currentColor in WebKit too.
  return <span className={`platform-icon platform-icon-${platform}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: source }} />;
}
