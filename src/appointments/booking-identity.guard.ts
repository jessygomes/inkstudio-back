import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Guest booking is allowed; supplied credentials must be valid client credentials. */
@Injectable()
export class BookingIdentityGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string }; user?: unknown }>();
    if (request.headers.authorization === undefined) {
      request.user = undefined;
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest<TUser>(
    error: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    const principal = super.handleRequest<TUser>(error, user, info, context);
    if ((principal as { role?: string }).role !== 'client') {
      throw new ForbiddenException(
        'Un compte client est requis pour réserver en étant connecté.',
      );
    }
    return principal;
  }
}
