export interface AdminSize { productId: string; size: 'S' | 'M' | 'L'; extraPrice: string; isActive: boolean; }
export interface AdminTopping { id: string; name: string; price: string; isActive: boolean; version: number; createdAt: string; updatedAt: string; }
export interface SizeList { items: AdminSize[]; productVersion: number; }
export interface AssociationList { items: AdminTopping[]; productVersion: number; }
