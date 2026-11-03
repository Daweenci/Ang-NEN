import { create } from 'zustand';
import type { broadcastedLobby, ChatMessage, Friend, friendRequest, LobbyInvite, PageType, Player, PrivateChatState, PrivateMessage, TypingPlayer, yourLobby } from './structs';
import { Page } from './structs';

// Last read private message per (me, friend), kept in localStorage so unread
// counts survive a reload. Keyed by both IDs because several accounts can
// share one browser.
const lastReadKey = (myID: string, friendID: string) => `privateChatRead:${myID}:${friendID}`;

function getLastReadID(myID: string, friendID: string): number {
    try {
        return Number(localStorage.getItem(lastReadKey(myID, friendID))) || 0;
    } catch {
        return 0;
    }
}

function setLastReadID(myID: string, friendID: string, id: number) {
    try {
        localStorage.setItem(lastReadKey(myID, friendID), String(id));
    } catch {
        // storage unavailable, unread count just won't persist
    }
}

const emptyChat = (): PrivateChatState => ({ messages: [], unread: 0, lastActivity: 0, isTyping: false });

export interface Store {
    player: Player;
    broadcastedLobbies: broadcastedLobby[];
    lobby: yourLobby;
    pendingFriendRequests: friendRequest[];
    friendsList: Friend[];
    currentPage: PageType;
    pendingInvites: LobbyInvite[];
    chatMessages: ChatMessage[];
    typingPlayers: TypingPlayer[];
    privateChats: Record<string, PrivateChatState>; // friendID -> chat
    activePrivateChatID: string | null; // chat currently open on screen

    setPlayer: (player: Player) => void;
    setBroadcastedLobbies: (lobbies: broadcastedLobby[]) => void;
    setLobby: (lobby: yourLobby) => void;
    setPendingFriendRequests: (requests: friendRequest[]) => void;
    setFriendsList: (friends: Friend[]) => void;
    setPage: (page: PageType) => void;
    setPendingInvites: (invites: LobbyInvite[]) => void;
    setChatMessages: (messages: ChatMessage[]) => void;
    setTypingPlayers: (players: TypingPlayer[]) => void;

    enterLobby: (data: { lobby: yourLobby; chatMessages?: ChatMessage[] }) => void;
    resetLobbyState: (page: PageType) => void;

    addPendingFriendRequest: (request: friendRequest) => void;
    removePendingFriendRequest: (id: string) => void;

    addFriend: (friend: Friend) => void;
    updateFriendStatus: (friend: Friend) => void;

    addInvite: (invite: LobbyInvite) => void;
    removeInvite: (lobbyID: string) => void;

    addChatMessage: (msg: ChatMessage) => void;
    clearChat: () => void;

    addTypingPlayer: (player: TypingPlayer) => void;
    removeTypingPlayer: (playerID: string) => void;
    clearTypingPlayers: () => void;


    removeFriend: (friendID: string) => void;

    setPrivateHistory: (friendID: string, messages: PrivateMessage[]) => void;
    addPrivateMessage: (friendID: string, message: PrivateMessage) => void;
    setPrivateTyping: (friendID: string, isTyping: boolean) => void;
    setActivePrivateChat: (friendID: string | null) => void;
    markPrivateRead: (friendID: string) => void;
    clearPrivateChats: () => void;
}

export const useStore = create<Store>((set) => ({
    player: {} as Player,
    broadcastedLobbies: [],
    lobby: {} as yourLobby,
    pendingFriendRequests: [],
    friendsList: [],
    currentPage: Page.Auth,
    pendingInvites: [],
    chatMessages: [],
    typingPlayers: [],
    privateChats: {},
    activePrivateChatID: null,

    setPlayer: (player) => set({ player }),
    setBroadcastedLobbies: (lobbies) => set({ broadcastedLobbies: lobbies }),
    setLobby: (lobby) => set({ lobby }),
    setPendingFriendRequests: (requests) => set({ pendingFriendRequests: requests }),
    setFriendsList: (friends) => set({ friendsList: friends }),
    setPage: (page) => set({ currentPage: page }),
    setPendingInvites: (invites) => set({ pendingInvites: invites }),
    setChatMessages: (messages) => set({ chatMessages: messages }),
    setTypingPlayers: (players) => set({ typingPlayers: players }),

    enterLobby: ({
        lobby,
        chatMessages,
        }: {
        lobby: yourLobby;
        chatMessages?: ChatMessage[];
        }) =>
        set({
            lobby,
            chatMessages: chatMessages ?? [],
            typingPlayers: [],
            currentPage: Page.InLobby,
        }),

    resetLobbyState: (page: PageType) =>
        set({
            lobby: {} as yourLobby,
            chatMessages: [],
            typingPlayers: [],
            currentPage: page,
        }),

    addPendingFriendRequest: (request) =>
        set((state) => ({
        pendingFriendRequests: [...state.pendingFriendRequests, request],
        })),

    removePendingFriendRequest: (id) =>
        set((state) => ({
        pendingFriendRequests: state.pendingFriendRequests.filter((r) => r.id !== id),
        })),

    addFriend: (friend) =>
        set((state) => ({
        friendsList: [...state.friendsList, friend],
        })),

    updateFriendStatus: (friend) =>
        set((state) => ({
        friendsList: state.friendsList.map((f) =>
            f.id === friend.id ? { ...f, isOnline: friend.isOnline } : f
        ),
        })),

    addInvite: (invite) =>
        set((state) => ({
        pendingInvites: [...state.pendingInvites, invite],
        })),

    removeInvite: (lobbyID) =>
        set((state) => ({
        pendingInvites: state.pendingInvites.filter((i) => i.lobbyID !== lobbyID),
        })),

    addChatMessage: (msg) =>
        set((state) => ({
        chatMessages: [...state.chatMessages, msg],
        })),

    clearChat: () => set({ chatMessages: [] }),

    addTypingPlayer: (player) =>
        set((state) => {
        if (state.typingPlayers.find((p) => p.playerID === player.playerID)) {
            return state;
        }
        return {
            typingPlayers: [...state.typingPlayers, player],
        };
        }),

    removeTypingPlayer: (playerID) =>
        set((state) => ({
        typingPlayers: state.typingPlayers.filter((p) => p.playerID !== playerID),
        })),

    clearTypingPlayers: () => set({ typingPlayers: [] }),

    removeFriend: (friendID) =>
        set((state) => {
            const friendExists = state.friendsList.some((f) => f.id === friendID);
            if (!friendExists) return state;
            const privateChats = { ...state.privateChats };
            delete privateChats[friendID];
            return {
                friendsList: state.friendsList.filter((f) => f.id !== friendID),
                privateChats,
                activePrivateChatID: state.activePrivateChatID === friendID ? null : state.activePrivateChatID,
            };
        }),

    setPrivateHistory: (friendID, messages) =>
        set((state) => {
            const myID = state.player.id;
            const isOpen = state.activePrivateChatID === friendID;
            const last = messages[messages.length - 1];
            if (isOpen && last) setLastReadID(myID, friendID, last.id);
            const lastReadID = getLastReadID(myID, friendID);
            const unread = isOpen
                ? 0
                : messages.filter((m) => m.senderID !== myID && m.id > lastReadID).length;
            const prev = state.privateChats[friendID] ?? emptyChat();
            return {
                privateChats: {
                    ...state.privateChats,
                    [friendID]: { ...prev, messages, unread, lastActivity: last?.timestamp ?? 0 },
                },
            };
        }),

    addPrivateMessage: (friendID, message) =>
        set((state) => {
            const myID = state.player.id;
            const prev = state.privateChats[friendID] ?? emptyChat();
            if (prev.messages.some((m) => m.id === message.id)) return state;

            const isOwn = message.senderID === myID;
            const isOpen = state.activePrivateChatID === friendID;
            if (isOwn || isOpen) setLastReadID(myID, friendID, message.id);

            return {
                privateChats: {
                    ...state.privateChats,
                    [friendID]: {
                        messages: [...prev.messages, message],
                        unread: isOwn || isOpen ? 0 : prev.unread + 1,
                        lastActivity: message.timestamp,
                        isTyping: isOwn ? prev.isTyping : false,
                    },
                },
            };
        }),

    setPrivateTyping: (friendID, isTyping) =>
        set((state) => {
            const prev = state.privateChats[friendID] ?? emptyChat();
            if (prev.isTyping === isTyping) return state;
            return { privateChats: { ...state.privateChats, [friendID]: { ...prev, isTyping } } };
        }),

    setActivePrivateChat: (friendID) => set({ activePrivateChatID: friendID }),

    markPrivateRead: (friendID) =>
        set((state) => {
            const chat = state.privateChats[friendID];
            if (!chat) return state;
            const last = chat.messages[chat.messages.length - 1];
            if (last) setLastReadID(state.player.id, friendID, last.id);
            if (chat.unread === 0) return state;
            return { privateChats: { ...state.privateChats, [friendID]: { ...chat, unread: 0 } } };
        }),

    clearPrivateChats: () => set({ privateChats: {}, activePrivateChatID: null }),
}));