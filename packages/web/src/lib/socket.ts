import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
let currentToken: string | null = null;

function getSocketOrigin(): string {
  const apiBase =
    (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api/v1';
  return new URL(apiBase, window.location.origin).origin;
}

export function connectRealtime(token: string): void {
  if (!token) {
    return;
  }

  if (socket && currentToken === token) {
    return;
  }

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  currentToken = token;
  socket = io(getSocketOrigin(), {
    auth: { token },
    reconnection: true,
    transports: ['websocket'],
  });
}

export function disconnectRealtime(): void {
  if (socket) {
    socket.disconnect();
  }

  socket = null;
  currentToken = null;
}

export function subscribeRealtime<TPayload = Record<string, unknown>>(
  event: string,
  handler: (payload: TPayload) => void,
): () => void {
  if (!socket) {
    return () => undefined;
  }

  const listener = (payload: TPayload): void => {
    handler(payload);
  };

  socket.on(event, listener);

  return () => {
    socket?.off(event, listener);
  };
}
