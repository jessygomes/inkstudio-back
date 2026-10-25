import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { ProjectsService } from './projects.service';
import {
  ExploreProjectsDto,
  ProposeProjectDto,
  PublishProjectDto,
  ReportProfessionalDto,
  RespondProposalDto,
} from './dto/project.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private projects: ProjectsService) {}
  @Get('options') options() {
    return this.projects.options();
  }
  @Get('explore') explore(
    @Request() req: RequestWithUser,
    @Query() query: ExploreProjectsDto,
  ) {
    return this.projects.explore(req.user.userId, query);
  }
  @Get('proposals') proposals(
    @Request() req: RequestWithUser,
    @Query('conversationId') id?: string,
    @Query('moodboardId') moodboardId?: string,
  ) {
    return this.projects.list(req.user.userId, id, moodboardId);
  }
  @Patch('moodboards/:id') publish(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: PublishProjectDto,
  ) {
    return this.projects.publish(id, req.user.userId, dto);
  }
  @Post('moodboards/:id/proposals') propose(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: ProposeProjectDto,
  ) {
    return this.projects.propose(id, req.user.userId, dto.message);
  }
  @Patch('proposals/:id') respond(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: RespondProposalDto,
  ) {
    return this.projects.respond(id, req.user.userId, dto.status);
  }
  @Post('professionals/:id/block') block(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ) {
    return this.projects.block(req.user.userId, id, true);
  }
  @Delete('professionals/:id/block') unblock(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ) {
    return this.projects.block(req.user.userId, id, false);
  }
  @Post('professionals/:id/report') report(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: ReportProfessionalDto,
  ) {
    return this.projects.report(req.user.userId, id, dto);
  }
}
