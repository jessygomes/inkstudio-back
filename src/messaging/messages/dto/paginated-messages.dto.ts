import { MessageResponseDto } from './message-response.dto';

export class PaginatedMessagesDto {
  data: MessageResponseDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}
