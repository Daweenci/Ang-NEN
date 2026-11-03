export type Player = {
  name: string;
  id: string;
};

export type Friend = {
  id: string;
  name: string;
  isOnline: boolean;
};

export type yourLobby = {
  id: string;
  name: string;
  maxPlayers: number;
  isPrivate: boolean;
  password: string;
  players: Player[];
  gameStart: PlayersStarted[];
};

export type broadcastedLobby = {
  id: string;
  name: string;
  maxPlayers: number;
  isPrivate: boolean;
  players: Player[];
  gameStart: PlayersStarted[];
};

export type friendRequest = {
  id: string;
  name: string;
};

export type LobbyInvite = {
  lobbyID: string;
  lobbyName: string;
  inviterID: string;
  inviterName: string;
};

export type ChatMessage = {
  senderID: string;
  senderName: string;
  content: string;
};

export type PrivateMessage = {
  id: number;
  senderID: string;
  content: string;
  timestamp: number;
};

export type PrivateChatState = {
  messages: PrivateMessage[];
  unread: number;
  lastActivity: number; // timestamp of most recent message either side
  isTyping: boolean; // friend is typing to us
};

export type TypingPlayer = {
  playerID: string;
  playerName: string;
};

export const MessageTypes = {
  // Requests (sent from client)
  RequestAuthentication: "authenticate",
  RequestLogin: "login",
  RequestRegister: "register",
  RequestCreateLobby: "create_lobby",
  RequestJoinLobby: "join_lobby",
  RequestLeaveLobby: "leave_lobby",
  RequestStartGame: "start_game",
  RequestCancelGame: "cancel_game",
  RequestAddFriend: "add_friend",
  RequestRemoveFriend: "remove_friend",
  RequestAcceptFriendRequest: "accept_friend_request",
  RequestInviteToLobby: "invite_to_lobby",
  RequestDeclineInvite: "decline_invite",
  RequestAddBotToLobby: "add_bot_to_lobby",
  RequestRemoveBotFromLobby: "remove_bot_from_lobby",
  RequestStartedTyping: "started_typing",
  RequestSendLobbyChatMessage: "send_lobby_chat_message",
  RequestSendPrivateMessage: "send_private_message",
  RequestGetPrivateMessages: "get_private_messages",
  RequestPrivateTyping: "private_typing",

  // Responses (sent from server)
  ResponseWelcome: "welcome",
  ResponseLoginSuccessful: "login_successful",
  ResponseLoginFailed: "login_failed",
  ResponseRegisterSuccessful: "register_successful",
  ResponseRegisterFailed: "register_failed",
  ResponseLobbyCreated: "lobby_created",
  ResponseLobbyList: "lobby_list",
  ResponseLobbyUpdated: "lobby_updated",
  ResponseJoinLobbySuccessful: "join_lobby_successful",
  ResponseJoinLobbyFailed: "join_lobby_failed",
  ResponseLobbyLeft: "lobby_left",
  ResponseFriendRequestSent: "friend_request_sent",
  ResponsePendingFriendRequests: "pending_friend_requests",
  ResponseFriendRequestReceived: "friend_request_received",
  ResponseFriendRequestAccepted: "friend_request_accepted",
  ResponseFriendOnlineStatus: "friend_online_status",
  ResponseFriendsList: "friends_list",
  ResponseInviteSent: "invite_sent",
  ResponseInviteReceived: "invite_received",
  ResponsePlayerTyping: "player_typing",
  ResponseLobbyChatMessage: "lobby_chat_message",
  ResponseInviteDeclined: "invite_declined",
  ResponseError: "error",
  ResponseFriendRemoved: "friend_removed",
  ResponsePrivateMessage: "private_message",
  ResponsePrivateMessages: "private_messages",
  ResponsePrivateTyping: "private_typing_status",
} as const;

export const Page = {
  Auth: "auth",
  MainMenu: "main_menu",
  InLobby: "in_lobby",
  LobbyScreen: "lobby_screen",
} as const;

export type PageType = typeof Page[keyof typeof Page];

type PlayersStarted = {
  playerID: string;
};