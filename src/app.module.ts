import { Module } from '@nestjs/common';
import { UserModule } from './user/user.module';
import { UserController } from './user/user.controller';
import { UserService } from './user/user.service';
import { PrismaService } from './database/prisma.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { AppointmentsService } from './appointments/appointments.service';
import { AppointmentsController } from './appointments/appointments.controller';
import { AppointmentsModule } from './appointments/appointments.module';
import { TatoueursModule } from './tatoueurs/tatoueurs.module';
import { ClientsService } from './clients/clients.service';
import { ClientsController } from './clients/clients.controller';
import { ClientsModule } from './clients/clients.module';
import { TattooHistoryService } from './tattoo-history/tattoo-history.service';
import { TattooHistoryController } from './tattoo-history/tattoo-history.controller';
import { TattooHistoryModule } from './tattoo-history/tattoo-history.module';
import { AftercareModule } from './aftercare/aftercare.module';
import { TimeSlotModule } from './time-slot/time-slot.module';
import { MailModule } from './email/mail.module';
import { PortfolioService } from './portfolio/portfolio.service';
import { PortfolioController } from './portfolio/portfolio.controller';
import { PortfolioModule } from './portfolio/portfolio.module';
import { ProductSalonController } from './product-salon/product-salon.controller';
import { ProductSalonModule } from './product-salon/product-salon.module';
import { BullModule } from '@nestjs/bull';
import { FollowUpModule } from './follow-up/follow-up.module';
import { SaasModule } from './saas/saas.module';
import { BlockedTimeSlotsModule } from './blocked-time-slots/blocked-time-slots.module';
import { VideoCallModule } from './video-call/video-call.module';

@Module({
  imports: [
    UserModule,
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    AppointmentsModule,
    TatoueursModule,
    ClientsModule,
    TattooHistoryModule,
    AftercareModule,
    TimeSlotModule,
    MailModule,
    PortfolioModule,
    ProductSalonModule,
    // 🔴 Configuration Redis globale pour Bull
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        // Configuration pour la stabilité
        connectTimeout: 10000,
        lazyConnect: true,
      },
    }),
    // Note: Les queues individuelles sont gérées dans leurs modules respectifs
    FollowUpModule,
    SaasModule,
    BlockedTimeSlotsModule,
    VideoCallModule,
  ],
  controllers: [
    UserController,
    AppointmentsController,
    ClientsController,
    TattooHistoryController,
    PortfolioController,
    ProductSalonController,
  ],
  providers: [
    UserService,
    PrismaService,
    AppointmentsService,
    ClientsService,
    TattooHistoryService,
    PortfolioService,
  ],
})
export class AppModule {}
