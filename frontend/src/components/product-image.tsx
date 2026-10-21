'use client';
import Image from 'next/image';
import { useState } from 'react';
export function ProductImage({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return <Image src={failed ? '/images/drink-placeholder.svg' : src} alt={`Đồ uống ${name}`} width={720} height={600}
    unoptimized onError={() => setFailed(true)} className="product-image" />;
}
