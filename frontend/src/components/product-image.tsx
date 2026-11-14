'use client';
import Image from 'next/image';
import { useState } from 'react';
import { productImageCandidates } from '../lib/product-images';
export function ProductImage({ src, name }: { src: string; name: string }) {
  return <ProductImageSource key={`${src}:${name}`} src={src} name={name} />;
}
function ProductImageSource({ src, name }: { src: string; name: string }) {
  const candidates = productImageCandidates(src, name);
  const [attempt, setAttempt] = useState(0);
  return <Image src={candidates[Math.min(attempt, candidates.length - 1)]} alt={`Đồ uống ${name}`} width={720} height={600}
    unoptimized onError={() => setAttempt(current => Math.min(current + 1, candidates.length - 1))} className="product-image" />;
}
