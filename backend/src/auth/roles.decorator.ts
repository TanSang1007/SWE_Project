import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../generated/prisma/client';

export const ROLES_KEY = 'brewlite:roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
