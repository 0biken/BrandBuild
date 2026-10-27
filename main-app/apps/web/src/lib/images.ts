/**
 * Decorative photography for the public pages. Seeded picsum URLs are stable
 * per seed. Swap for owned brand photography before launch.
 */
export const photo = (seed: string, w = 1600, h = 1000) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`;
