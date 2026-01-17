import { UnreadConversationResponseDto } from './unread-conversation-response.dto';

export class PaginatedUnreadConversationsDto {
  data: UnreadConversationResponseDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
