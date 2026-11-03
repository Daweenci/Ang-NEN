# Web Lobby (React + Express)

Echtzeit-Spiellobby mit **React** (Vite, TypeScript, Zustand) im Frontend und **Express + WebSockets (`ws`)** im Backend.
Portierung von [Daweenci/Web_Lobby](https://github.com/Daweenci/Web_Lobby): Das Go-Backend wurde komplett in Node.js/Express neu geschrieben, das React-Frontend und das WebSocket-Protokoll sind unverändert.

## Features (WebSockets mit React)

| Anforderung | Umsetzung |
|---|---|
| Echtzeit-Updates von Daten | Lobby-Liste (`lobby_list`) und Lobby-Zustand (`lobby_updated`: Spieler, Bots, Bereit-Status) werden an alle Clients gepusht |
| Live-Benachrichtigungen bei neuen Einträgen | Freundschaftsanfragen (`friend_request_received`), Lobby-Einladungen (`invite_received`), Online-/Offline-Status von Freunden, Bot betritt/verlässt Lobby |
| Kollaboratives Bearbeiten | Gemeinsamer Lobby-Chat mit „schreibt gerade…“-Anzeige (`player_typing`), gemeinsamer Bereit-Status, Bots hinzufügen/entfernen |
| Live-Aktualisierung ohne Neuladen | Alles läuft über eine dauerhafte WebSocket-Verbindung (`/ws`), REST nur für Login/Registrierung |

Zusätzlich: KI-Bots (Google Gemini) mit Persönlichkeiten, die im Lobby-Chat mitschreiben.

## Struktur

```
client/            React-Frontend (Vite)
server/
  schema.sql       SQLite-Schema
  src/
    index.js         Express-App, HTTP-Server, statische Auslieferung des Builds
    auth.js          POST /login, POST /register (JWT)
    websocket.js     WebSocket-Server, Authentifizierung, Message-Routing
    handlers.js      Lobby-, Freundes-, Chat-, Einladungs- und Bot-Logik
    broadcasting.js  Push an Lobby-Mitglieder / alle Clients
    botPlayer.js     Gemini-Bots
    state.js         In-Memory-Zustand (Lobbys, aktive Spieler, Einladungen)
    db.js, playerStore.js, friendsStore.js, jwt.js, util.js
```

## Setup

Voraussetzung: Node.js 20+

```bash
npm install
npm run install:all
cp server/.env.example server/.env   # JWT_SECRET setzen, optional GEMINI_API_KEY
```

## Starten

Entwicklung (Server auf :4000 mit Auto-Reload, Vite auf :5173):

```bash
npm run dev
```

Produktion (Express liefert den React-Build selbst aus, alles auf :4000):

```bash
npm run build
npm start
```

## WebSocket-Protokoll

Nach dem Verbindungsaufbau schickt der Client `{ "type": "authenticate", "token": "<JWT>" }` und bekommt `welcome` (Spieler, Lobbys, Freunde, offene Anfragen).
Alle weiteren Nachrichten sind JSON mit einem `type`-Feld; die Liste steht in `server/src/messageTypes.js` bzw. `client/src/structs.tsx`.
