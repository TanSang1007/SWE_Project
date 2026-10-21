import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../../generated/prisma/client';
import { ROLES_KEY } from '../roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<readonly UserRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    const request = context.switchToHttp().getRequest<{ user?: { role?: unknown } }>();
    const role = request.user?.role;
    if (!allowed?.length || typeof role !== 'string' || !['CUSTOMER', 'STAFF', 'ADMIN'].includes(role)
      || !allowed.includes(role as UserRole)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission for this action' });
    }
    return true;
  }
}
