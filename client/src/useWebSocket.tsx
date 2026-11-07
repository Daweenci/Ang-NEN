import { useRef, useEffect } from 'react';
import type { yourLobby, Player, LobbyInvite, Friend } from './structs';
import { MessageTypes, Page } from './structs';
import { toast } from 'sonner';
import { useStore } from './store';

export function useWebSocket() {

  const ws = useRef<WebSocket | null>(null);
  const joinLobbyRef = useRef<(lobbyID: string, password: string) => void>(() => {});
  const declineInviteRef = useRef<(lobbyID: string) => void>(() => {});

  // The session token is an HttpOnly cookie set by /login and /register.
  // Scripts can't read it; the browser sends it along with the WebSocket handshake.
  const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

  const resetToAuth = () => {
    useStore.getState().setPlayer({} as Player);
    useStore.getState().setLobby({} as yourLobby);
    useStore.getState().setBroadcastedLobbies([]);
    useStore.getState().clearPrivateChats();
    useStore.getState().setPage(Page.Auth);
  };

  const getPlayersLeft = (prev: Player[] = [], next: Player[] = []) => {
    return prev.filter(
      (p) => !next.some((player) => player.id === p.id)
    );
  };

  const getPlayersJoined = (prev: Player[] = [], next: Player[] = []) => {
    return next.filter(
      (p) => !prev.some((pp) => pp.id === p.id)
    );
  };

  useEffect(() => {
    const handleUnload = () => {
      if (!ws.current) return;
      ws.current.onclose = null;
      ws.current.close();
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);

  const connect = () => {
    if (
      ws.current &&
      (ws.current.readyState === WebSocket.CONNECTING ||
        ws.current.readyState === WebSocket.OPEN)
    ) return;

    if (ws.current) {
      ws.current.onopen = null;
      ws.current.onmessage = null;
      ws.current.onerror = null;
      ws.current.onclose = null;
      ws.current.close();
      ws.current = null;
    }

    const socket = new WebSocket(wsUrl);
    ws.current = socket;
    // The server rejects the handshake without a valid session cookie, so a
    // socket that never opened means "not logged in" rather than a lost connection.
    let opened = false;

    socket.onopen = () => {
      if (ws.current !== socket) return;
      opened = true; // the server sends "welcome" on its own
    };

    // Load stored private chats so previews and unread badges are there right away
    const requestPrivateHistories = (friends: Friend[]) => {
      for (const f of friends) {
        socket.send(JSON.stringify({ type: MessageTypes.RequestGetPrivateMessages, friendID: f.id }));
      }
    };

    socket.onmessage = (event) => {
      if (ws.current !== socket) return;
      const data = JSON.parse(event.data);
      console.log('WebSocket message received:', data);

      switch (data.type) {

        case MessageTypes.ResponseWelcome:
          useStore.getState().setPlayer(data.player);
          useStore.getState().setPage(Page.MainMenu);
          if (data.message) toast(data.message);
          if (data.lobbies) useStore.getState().setBroadcastedLobbies(data.lobbies);
          if (data.pendingFriendRequests) useStore.getState().setPendingFriendRequests(data.pendingFriendRequests);
          if (data.friendsList) {
            useStore.getState().setFriendsList(data.friendsList);
            requestPrivateHistories(data.friendsList);
          }
          break;

        case MessageTypes.ResponseLobbyList:
          useStore.getState().setBroadcastedLobbies(data.lobbies);
          break;

        case MessageTypes.ResponseLobbyCreated:
          useStore.getState().enterLobby({ lobby: data.lobby });
          toast('Lobby created successfully');
          break;

        case MessageTypes.ResponseJoinLobbySuccessful:
          useStore.getState().enterLobby({ lobby: data.lobby, chatMessages: data.chatHistory });
          useStore.getState().removeInvite(data.lobby.id);
          toast.dismiss();
          toast('Joined lobby successfully');
          break;

        case MessageTypes.ResponseJoinLobbyFailed:
          toast(data.message || 'Failed to join lobby');
          break;

        case MessageTypes.ResponseLobbyUpdated: {
          const store = useStore.getState();

          const prevLobby = store.lobby;
          const newLobby = data.lobby;

          if (prevLobby.id === newLobby.id) {
            const leftPlayers = getPlayersLeft(
              prevLobby.players,
              newLobby.players
            );

            const joinedPlayers = getPlayersJoined(
              prevLobby.players,
              newLobby.players
            );

            leftPlayers.forEach((p) => {
              toast(`${p.name} left the lobby`);
            });

            joinedPlayers.forEach((p) => {
              toast(`${p.name} joined the lobby`);
            });
          }

          store.setLobby(newLobby);
          break;
        }

        case MessageTypes.ResponseLobbyLeft:
          useStore.getState().resetLobbyState(Page.MainMenu);
          break;

        case MessageTypes.ResponsePendingFriendRequests:
          useStore.getState().setPendingFriendRequests(data.pendingFriendRequests);
          break;

        case MessageTypes.ResponseFriendsList:
          useStore.getState().setFriendsList(data.friendsList);
          requestPrivateHistories(data.friendsList);
          break;

        case MessageTypes.ResponseFriendRequestSent:
          toast(data.message);
          break;

        case MessageTypes.ResponseFriendRequestReceived: {
          const request = { id: data.player.id, name: data.player.name };
          useStore.getState().addPendingFriendRequest(request);

          const toastID = `friend-request-${data.player.id}`;

          toast.custom( //TODO: extract to its own file
            () => (
              <div className="flex flex-col gap-2 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 min-w-[280px]">
                <p className="text-sm text-gray-800">
                  <strong>{data.player.name}</strong> sent you a friend request
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      acceptFriendRequest(data.player.id, true);
                      toast.dismiss(toastID);
                    }}
                    className="flex-1 bg-green-500 hover:bg-green-600 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => {
                      acceptFriendRequest(data.player.id, false);
                      toast.dismiss(toastID);
                    }}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium px-3 py-1.5 rounded-lg transition"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ),
            { id: toastID, duration: Infinity }
          );
          break;
        }

        case MessageTypes.ResponseFriendRequestAccepted:
          useStore.getState().addFriend(data.friend);
          requestPrivateHistories([data.friend]);
          toast('Friend request accepted by ' + data.friend.name);
          break;

        case MessageTypes.ResponseFriendOnlineStatus:
          useStore.getState().updateFriendStatus(data.friend);
          toast(`${data.friend.name} is now ${data.friend.isOnline ? 'online' : 'offline'}`);
          break;

        case MessageTypes.ResponseInviteReceived: {
          const invite: LobbyInvite = {
            lobbyID: data.lobbyID,
            lobbyName: data.lobbyName,
            inviterID: data.inviterID,
            inviterName: data.inviterName,
          };
          useStore.getState().addInvite(invite);

          const toastID = `invite-${data.lobbyID}`;

          toast.custom( //TODO: extract to its own file
            () => (
              <div className="flex flex-col gap-2 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 min-w-[280px]">
                <p className="text-sm text-gray-800">
                  <strong>{data.inviterName}</strong> invited you to <strong>{data.lobbyName}</strong>
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      joinLobbyRef.current(data.lobbyID, '');
                      toast.dismiss(toastID);
                    }}
                    className="flex-1 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition"
                  >
                    Join
                  </button>
                  <button
                    onClick={() => {
                      declineInviteRef.current(data.lobbyID);
                      toast.dismiss(toastID);
                    }}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium px-3 py-1.5 rounded-lg transition"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ),
            { id: toastID, duration: 4000 }
          );
          break;
        }

        case MessageTypes.ResponseInviteSent:
          toast(data.message);
          break;

        case MessageTypes.ResponseInviteDeclined:
          useStore.getState().removeInvite(data.lobbyID);
          toast.dismiss(`invite-${data.lobbyID}`);
          break;

        case MessageTypes.ResponseLobbyChatMessage:
          useStore.getState().addChatMessage({
            senderID: data.senderID,
            senderName: data.senderName,
            content: data.content,
          });
          useStore.getState().removeTypingPlayer(data.senderID);
          break;

        case MessageTypes.ResponsePlayerTyping:
          if (data.isTyping) {
            useStore.getState().addTypingPlayer({ playerID: data.playerID, playerName: data.playerName });
          } else {
            useStore.getState().removeTypingPlayer(data.playerID);
          }
          break;
        
        case MessageTypes.ResponseFriendRemoved:
          var friendName = '';
          useStore.getState().friendsList.forEach((f) => {
            if (f.id === data.friendID) {
              friendName = f.name;
            }
          });
          useStore.getState().removeFriend(data.friendID);
          toast(`Removed ${friendName} from friends list`);
          break;

        case MessageTypes.ResponsePrivateMessages:
          useStore.getState().setPrivateHistory(data.friendID, data.messages);
          break;

        case MessageTypes.ResponsePrivateMessage: {
          const store = useStore.getState();
          store.addPrivateMessage(data.friendID, data.message);

          const isIncoming = data.message.senderID !== store.player.id;
          if (isIncoming && store.activePrivateChatID !== data.friendID) {
            const friend = store.friendsList.find((f) => f.id === data.friendID);
            toast(`${friend?.name ?? 'Friend'}: ${data.message.content}`, { id: `pm-${data.friendID}` });
          }
          break;
        }

        case MessageTypes.ResponsePrivateTyping:
          useStore.getState().setPrivateTyping(data.friendID, data.isTyping);
          break;

        case MessageTypes.ResponseError:
          toast(data.error || 'An error occurred');
          break;

        default:
          console.warn('Unknown message type:', data.type);
      }
    };

    socket.onerror = (err) => {
      if (ws.current !== socket) return;
      if (!opened) return; // handshake rejected: handled in onclose
      console.error('WebSocket error:', err);
      toast('Connection error');
    };

    socket.onclose = (event) => {
      if (ws.current !== socket) return;
      console.log('WebSocket closed', event.code, event.reason);
      ws.current = null;
      if (!opened) {
        resetToAuth(); // no valid session
      } else if (event.code === 1008) {
        resetToAuth();
        toast('Logged in on another device');
      }
    };
  };

  const sendMessage = (msg: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    } else {
      console.error('WebSocket is not connected');
      toast('Connection lost, please refresh');
    }
  };

  const createLobby = (lobbyName: string, maxPlayers: number, isPrivate: boolean, password: string) =>
    sendMessage({ type: MessageTypes.RequestCreateLobby, lobbyName, maxPlayers, isPrivate, password });

  const joinLobby = (lobbyID: string, password: string) =>
    sendMessage({ type: MessageTypes.RequestJoinLobby, lobbyID, password });

  const leaveLobby = (lobbyID: string) =>
    sendMessage({ type: MessageTypes.RequestLeaveLobby, lobbyID });

  const startGame = (lobbyID: string) =>
    sendMessage({ type: MessageTypes.RequestStartGame, lobbyID });

  const cancelGame = (lobbyID: string) =>
    sendMessage({ type: MessageTypes.RequestCancelGame, lobbyID });

  const addFriend = (friendName: string) =>
    sendMessage({ type: MessageTypes.RequestAddFriend, friendName });

  const removeFriend = (friendID: string) =>
    sendMessage({ type: MessageTypes.RequestRemoveFriend, friendID });

  const acceptFriendRequest = (friendID: string, acceptRequest: boolean) =>
    sendMessage({ type: MessageTypes.RequestAcceptFriendRequest, friendID, acceptRequest });

  const inviteToLobby = (lobbyID: string, friendID: string) =>
    sendMessage({ type: MessageTypes.RequestInviteToLobby, lobbyID, friendID });

  const declineInvite = (lobbyID: string) =>
    sendMessage({ type: MessageTypes.RequestDeclineInvite, lobbyID });

  const sendLobbyChatMessage = (lobbyID: string, content: string) =>
    sendMessage({ type: MessageTypes.RequestSendLobbyChatMessage, lobbyID, content });

  const startedTyping = (lobbyID: string) =>
    sendMessage({ type: MessageTypes.RequestStartedTyping, lobbyID, isTyping: true });

  const stoppedTyping = (lobbyID: string) =>
    sendMessage({ type: MessageTypes.RequestStartedTyping, lobbyID, isTyping: false });

  const sendPrivateMessage = (friendID: string, content: string) =>
    sendMessage({ type: MessageTypes.RequestSendPrivateMessage, friendID, content });
  const privateTyping = (friendID: string, isTyping: boolean) =>
    sendMessage({ type: MessageTypes.RequestPrivateTyping, friendID, isTyping });

  // Keep refs in sync so toast buttons always call the latest version
  joinLobbyRef.current = joinLobby;
  declineInviteRef.current = declineInvite;

  const logout = async () => {
    try {
      await fetch('/logout', { method: 'POST' }); // server clears the HttpOnly cookie
    } catch (err) {
      console.error('Logout request failed:', err);
    }
    if (ws.current) {
      ws.current.onopen = null;
      ws.current.onmessage = null;
      ws.current.onerror = null;
      ws.current.onclose = null;
      ws.current.close();
      ws.current = null;
    }
    resetToAuth();
  };

  useEffect(() => {
    // Try to resume an existing session; without a valid cookie the handshake
    // is rejected and the login page stays.
    connect();

    return () => {
      if (ws.current) {
        ws.current.onopen = null;
        ws.current.onmessage = null;
        ws.current.onerror = null;
        ws.current.onclose = null;
        ws.current.close();
        ws.current = null;
      }
    };
  }, []);

  return {
    connect,
    logout,
    addFriend,
    removeFriend,
    acceptFriendRequest,
    createLobby,
    joinLobby,
    leaveLobby,
    startGame,
    cancelGame,
    inviteToLobby,
    declineInvite,
    sendLobbyChatMessage,
    startedTyping,
    stoppedTyping,
    sendPrivateMessage,
    privateTyping,
  };
}
