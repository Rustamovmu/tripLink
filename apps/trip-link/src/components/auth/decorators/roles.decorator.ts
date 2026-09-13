import { SetMetadata } from '@nestjs/common';
import { MemberType } from '../../../libs/enums/member.enum';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: MemberType[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
