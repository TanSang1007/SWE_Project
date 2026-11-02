export const drinkPlaceholder = '/images/drink-placeholder.svg';
const menuImages: Record<string, string> = {
  cappuccino: '/images/cappuccino.jpg',
  latte: '/images/latte.jpg',
  'cold brew': '/images/cold-brew.jpg',
  coldbrew: '/images/cold-brew.jpg',
  'den da': '/images/den-da.jpg',
  'asian dolce latte': '/images/asian-dolce-latte.jpg',
  'matcha coldwisk': '/images/coldwisk.jpg',
  'cacao da': '/images/cacao-da.jpg',
};

// The seven known drinks use local photos even when the database points at
// another drink's photo. Unknown products retain their configured image URL.
export function productImageCandidates(src: string, name: string): string[] {
  const key = name.trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[-_\s]+/g, ' ');
  const local = Object.hasOwn(menuImages, key) ? menuImages[key] : undefined;
  if (local) return [local, drinkPlaceholder];
  const configured = src.trim();
  const isPlaceholder = configured.split(/[?#]/)[0] === drinkPlaceholder;
  return !configured || isPlaceholder ? [drinkPlaceholder] : [configured, drinkPlaceholder];
}
