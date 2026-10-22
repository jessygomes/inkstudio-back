import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequestWithUser } from '../../auth/jwt.strategy';
import { InboxService } from './inbox.service';
import {
  AddInboxNoteDto, AssignInboxThreadDto, CreateInboxClientDto,
  InboxMemberPermissionDto, InboxReadStateDto, InboxReplyDto,
  LinkInboxAppointmentDto, LinkInboxClientDto, ListInboxThreadsDto,
  SaveInboxReplyDto, UpdateInboxStatusDto,
} from './dto/inbox.dto';

/** Toutes les opérations prennent l'identité du JWT, jamais un ownerUserId fourni par le front. */
@Controller('messaging/inbox')
@UseGuards(JwtAuthGuard)
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  listThreads(@Request() req: RequestWithUser, @Query() query: ListInboxThreadsDto) {
    return this.inbox.listThreads(req.user.userId, query);
  }

  @Get('replies')
  listSavedReplies(@Request() req: RequestWithUser) {
    return this.inbox.listSavedReplies(req.user.userId);
  }

  @Post('replies')
  createSavedReply(@Request() req: RequestWithUser, @Body() dto: SaveInboxReplyDto) {
    return this.inbox.createSavedReply(req.user.userId, dto);
  }

  @Put('members/:memberUserId/permissions')
  setMemberPermission(
    @Request() req: RequestWithUser,
    @Param('memberUserId') memberUserId: string,
    @Body() dto: InboxMemberPermissionDto,
  ) {
    return this.inbox.setMemberPermission(req.user.userId, memberUserId, dto);
  }

  @Get(':threadId')
  getThread(@Request() req: RequestWithUser, @Param('threadId') threadId: string) {
    return this.inbox.getThread(req.user.userId, threadId);
  }

  @Get(':threadId/messages')
  getMessages(
    @Request() req: RequestWithUser,
    @Param('threadId') threadId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inbox.getMessages(req.user.userId, threadId, Number(page) || 1, Number(limit) || 50);
  }

  @Post(':threadId/reply')
  sendReply(@Request() req: RequestWithUser, @Param('threadId') threadId: string, @Body() dto: InboxReplyDto) {
    return this.inbox.sendReply(req.user.userId, threadId, dto);
  }

  @Patch(':threadId/status')
  setStatus(
    @Request() req: RequestWithUser,
    @Param('threadId') threadId: string,
    @Body() dto: UpdateInboxStatusDto,
  ) {
    return this.inbox.setStatus(req.user.userId, threadId, dto.status);
  }

  @Patch(':threadId/assignment')
  assignThread(@Request() req: RequestWithUser, @Param('threadId') threadId: string, @Body() dto: AssignInboxThreadDto) {
    return this.inbox.assignThread(req.user.userId, threadId, dto);
  }

  @Put(':threadId/client')
  linkClient(@Request() req: RequestWithUser, @Param('threadId') threadId: string, @Body() dto: LinkInboxClientDto) {
    return this.inbox.linkClient(req.user.userId, threadId, dto.clientId);
  }

  @Delete(':threadId/client')
  unlinkClient(@Request() req: RequestWithUser, @Param('threadId') threadId: string) {
    return this.inbox.unlinkClient(req.user.userId, threadId);
  }

  @Post(':threadId/client')
  createAndLinkClient(@Request() req: RequestWithUser, @Param('threadId') threadId: string, @Body() dto: CreateInboxClientDto) {
    return this.inbox.createAndLinkClient(req.user.userId, threadId, dto);
  }

  @Post(':threadId/appointments')
  linkAppointment(@Request() req: RequestWithUser, @Param('threadId') threadId: string, @Body() dto: LinkInboxAppointmentDto) {
    return this.inbox.linkAppointment(req.user.userId, threadId, dto.appointmentId);
  }

  @Get(':threadId/appointments')
  listAppointments(
    @Request() req: RequestWithUser,
    @Param('threadId') threadId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inbox.listAppointments(req.user.userId, threadId, Number(page) || 1, Number(limit) || 5);
  }

  @Get(':threadId/notes')
  listNotes(@Request() req: RequestWithUser, @Param('threadId') threadId: string) {
    return this.inbox.listNotes(req.user.userId, threadId);
  }

  @Post(':threadId/notes')
  addNote(@Request() req: RequestWithUser, @Param('threadId') threadId: string, @Body() dto: AddInboxNoteDto) {
    return this.inbox.addNote(req.user.userId, threadId, dto.content);
  }

  @Patch(':threadId/read-state')
  setReadState(@Request() req: RequestWithUser, @Param('threadId') threadId: string, @Body() dto: InboxReadStateDto) {
    return this.inbox.setReadState(req.user.userId, threadId, dto.forceUnread);
  }
}
