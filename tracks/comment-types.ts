/** Browser-safe discussion contracts. No server imports or private account fields. */
export type DiscussionAuthor = {
  name: string | null;
  deactivated: boolean;
  avatarUrl: string | null;
};
export type DiscussionPost = {
  id: string;
  text: string;
  createdAt: string;
  author: DiscussionAuthor;
};
export type TrackComment = DiscussionPost & {
  reply: DiscussionPost | null;
  canReply: boolean;
};
export type TrackCommentsPage = {
  page: number;
  pageSize: 10;
  total: number;
  pages: number;
  posting: "login" | "confirmEmail" | "allowed";
  comments: TrackComment[];
};
export type CreatedDiscussionPost = {
  id: string;
  commentId: string;
  page: number;
};
export type DiscussionErrorCode =
  | "unauthorized"
  | "emailUnconfirmed"
  | "forbidden"
  | "notFound"
  | "invalidRequest"
  | "invalidText"
  | "tooLarge"
  | "rateLimited"
  | "replyExists"
  | "unavailable";
