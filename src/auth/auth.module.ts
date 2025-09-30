import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from 'src/database/prisma.service';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { UserService } from 'src/user/user.service';
import { MailModule } from 'src/email/mail.module';
import { SaasModule } from 'src/saas/saas.module';
import { CacheService } from 'src/redis/cache.service';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1d' },
    }),
    SaasModule,
    MailModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PrismaService,
    UserService,
    JwtStrategy,
    CacheService,
  ],
})
export class AuthModule {}
