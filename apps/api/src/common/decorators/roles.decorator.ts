import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** Restringe um endpoint a uma lista de roles. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
