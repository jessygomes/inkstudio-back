/* eslint-disable prettier/prettier */
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
import { MailService } from './mailer.service';
import { PortfolioService } from './portfolio/portfolio.service';
import { PortfolioController } from './portfolio/portfolio.controller';
import { PortfolioModule } from './portfolio/portfolio.module';
import { ProductSalonController } from './product-salon/product-salon.controller';
import { ProductSalonModule } from './product-salon/product-salon.module';

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
    PortfolioModule,
    ProductSalonModule,
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
    MailService,
    PortfolioService,
  ],
})
export class AppModule {}
