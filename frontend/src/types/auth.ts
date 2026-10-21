export type UserRole = 'CUSTOMER' | 'STAFF' | 'ADMIN';
export interface PublicUser { id: string; email: string; loyaltyPoints: number; role: UserRole }
export interface Credentials { email: string; password: string }
export interface LoginResponse { accessToken: string; tokenType: 'Bearer'; expiresIn: 3600; user: PublicUser }
