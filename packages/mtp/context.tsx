import { toast } from "@methanium/ui";
import {
  ConnectionState,
  MTPClient,
  type MTPClientOptions,
  type MTPRequestOptions,
} from "mtp";
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { RECONNECT_RESET, RECONNECT_TRIES, RETRY_INTERVAL } from "./values.ts";

export type ProtocolMessage = {
  id?: number;
  type: string;
  data: unknown;
  sender?: bigint;
  receiver?: bigint;
};

export type BoundSendFn = (
  type: string,
  data?: Record<string, unknown>,
  options?: MTPRequestOptions,
) => Promise<ProtocolMessage>;

export type PushHandler = (message: ProtocolMessage) => void;

export type MTPExchange = {
  type: string;
  data: Record<string, unknown>;
  response: ProtocolMessage;
};

export type MTPInterceptor = (exchange: MTPExchange) => void | Promise<void>;

type Subscription = {
  type: string;
  handler: PushHandler;
  unsubscribe?: () => void;
};

type ClientWaiter = {
  resolve: (client: MTPClient) => void;
  reject: (error: Error) => void;
};

type ContextType = {
  send: BoundSendFn;
  subscribe: (type: string, handler: PushHandler) => () => void;
  addInterceptor: (interceptor: MTPInterceptor) => () => void;
  reconnect: () => void;
  readyState: number;
  connected: boolean;
  authenticated: boolean;
  contextReady: boolean;
  loadingDescription: string;
  error: Error | null;
};

const MTPContext = createContext<ContextType | undefined>(undefined);

export type MTPProviderProps = {
  children: ReactNode;
  options: MTPClientOptions | null;
  authenticate?: boolean;
  blockConnection?: boolean;
};

export function Provider({
  children,
  options,
  authenticate = true,
  blockConnection = false,
}: MTPProviderProps): JSX.Element {
  const [readyState, setReadyState] = useState<number>(
    ConnectionState.Disconnected,
  );
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reconnectGeneration, setReconnectGeneration] = useState(0);
  const clientRef = useRef<MTPClient | null>(null);
  const readyRef = useRef(false);
  const waitersRef = useRef(new Set<ClientWaiter>());
  const subscriptionsRef = useRef(new Set<Subscription>());
  const interceptorsRef = useRef(new Set<MTPInterceptor>());

  const unbindSubscriptions = useCallback(() => {
    for (const subscription of subscriptionsRef.current) {
      subscription.unsubscribe?.();
      subscription.unsubscribe = undefined;
    }
  }, []);

  const bindSubscriptions = useCallback((client: MTPClient) => {
    for (const subscription of subscriptionsRef.current) {
      subscription.unsubscribe?.();
      subscription.unsubscribe = client.subscribe(
        subscription.type,
        (message) => subscription.handler(message as ProtocolMessage),
      );
    }
  }, []);

  useEffect(() => {
    if (!options || blockConnection) {
      readyRef.current = false;
      setReadyState(ConnectionState.Disconnected);
      setAuthenticated(false);
      return;
    }
    const connectionOptions = options;

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectResetTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let connectionGeneration = 0;

    const disconnectClient = () => {
      readyRef.current = false;
      unbindSubscriptions();
      const activeClient = clientRef.current;
      clientRef.current = null;
      activeClient?.disconnect();
      setReadyState(ConnectionState.Disconnected);
      setAuthenticated(false);
    };

    const scheduleReconnect = (connectionError: Error) => {
      if (disposed || reconnectTimer) return;
      setError(connectionError);

      if (attempts >= RECONNECT_TRIES) {
        toast.error("MTP connection failed", {
          id: "mtp-connection",
          description: connectionError.message,
          duration: Infinity,
          closeButton: true,
        });
        return;
      }

      attempts += 1;
      toast.loading(`Reconnecting to MTP (${attempts}/${RECONNECT_TRIES})`, {
        id: "mtp-connection",
      });
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, RETRY_INTERVAL);
    };

    async function connect() {
      if (disposed) return;

      const generation = ++connectionGeneration;
      let client: MTPClient | null = null;
      try {
        disconnectClient();
        setError(null);
        setReadyState(ConnectionState.Connecting);

        await MTPClient.init(connectionOptions.wasm);
        client = await MTPClient.create({
          ...connectionOptions,
          logger: (event) => {
            connectionOptions.logger?.(event);
            if (disposed || generation !== connectionGeneration) return;
            if ((event as { type: string }).type !== "state") return;

            const nextState = client?.state ?? ConnectionState.Disconnected;
            setReadyState(nextState);
            if (
              client !== null &&
              nextState === ConnectionState.Disconnected &&
              clientRef.current === client
            ) {
              disconnectClient();
              scheduleReconnect(new Error("MTP connection lost"));
            }
          },
        });

        if (disposed || generation !== connectionGeneration) {
          client.disconnect();
          return;
        }

        clientRef.current = client;
        setReadyState(client.state);

        if (authenticate) {
          if (!client.credentials || client.credentials.clientId === null) {
            throw new Error("MTP credentials are required for authentication");
          }
          await client.auth();
        } else {
          await client.connect();
        }

        if (disposed || clientRef.current !== client) return;

        readyRef.current = true;
        setReadyState(client.state);
        setAuthenticated(true);
        setError(null);
        bindSubscriptions(client);
        for (const waiter of waitersRef.current) waiter.resolve(client);
        waitersRef.current.clear();
        toast.dismiss("mtp-connection");

        if (reconnectResetTimer) clearTimeout(reconnectResetTimer);
        reconnectResetTimer = setTimeout(() => {
          attempts = 0;
          reconnectResetTimer = null;
        }, RECONNECT_RESET * 1_000);
      } catch (cause) {
        if (disposed || generation !== connectionGeneration) {
          client?.disconnect();
          return;
        }

        disconnectClient();
        scheduleReconnect(
          cause instanceof Error ? cause : new Error(String(cause)),
        );
      }
    }

    void connect();

    return () => {
      disposed = true;
      connectionGeneration += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (reconnectResetTimer) clearTimeout(reconnectResetTimer);
      disconnectClient();
      toast.dismiss("mtp-connection");

      const cancellation = new Error("MTP provider was disconnected");
      for (const waiter of waitersRef.current) waiter.reject(cancellation);
      waitersRef.current.clear();
    };
  }, [
    authenticate,
    bindSubscriptions,
    blockConnection,
    options,
    reconnectGeneration,
    unbindSubscriptions,
  ]);

  const getClient = useCallback(() => {
    if (readyRef.current && clientRef.current) {
      return Promise.resolve(clientRef.current);
    }

    if (!options || blockConnection) {
      return Promise.reject(new Error("MTP connection is not configured"));
    }

    return new Promise<MTPClient>((resolve, reject) => {
      waitersRef.current.add({ resolve, reject });
    });
  }, [blockConnection, options]);

  const send = useCallback<BoundSendFn>(
    async (type, data = {}, requestOptions) => {
      const client = await getClient();
      const response = await client.request(type, data, requestOptions);
      const message = response as ProtocolMessage;

      for (const interceptor of interceptorsRef.current) {
        void Promise.resolve(
          interceptor({ type, data, response: message }),
        ).catch((interceptorError) => {
          console.error("MTP interceptor failed", interceptorError);
        });
      }

      return message;
    },
    [getClient],
  );

  const subscribe = useCallback((type: string, handler: PushHandler) => {
    const subscription: Subscription = { type, handler };
    subscriptionsRef.current.add(subscription);

    if (readyRef.current && clientRef.current) {
      subscription.unsubscribe = clientRef.current.subscribe(type, (message) =>
        handler(message as ProtocolMessage),
      );
    }

    return () => {
      subscription.unsubscribe?.();
      subscriptionsRef.current.delete(subscription);
    };
  }, []);

  const addInterceptor = useCallback((interceptor: MTPInterceptor) => {
    interceptorsRef.current.add(interceptor);
    return () => interceptorsRef.current.delete(interceptor);
  }, []);

  const reconnect = useCallback(() => {
    setReconnectGeneration((generation) => generation + 1);
  }, []);

  const connected = readyState === ConnectionState.Connected;
  const contextReady = connected && authenticated;
  const loadingDescription = useMemo(() => {
    if (!options) return "Waiting for connection configuration";
    if (error) return error.message;
    if (readyState === ConnectionState.Connecting || !connected) {
      return "Establishing transport channel";
    }
    if (!authenticated) return "Waiting for authenticated session";
    return "Connected";
  }, [authenticated, connected, error, options, readyState]);

  return (
    <MTPContext.Provider
      value={{
        send,
        subscribe,
        addInterceptor,
        reconnect,
        readyState,
        connected,
        authenticated,
        contextReady,
        loadingDescription,
        error,
      }}
    >
      {children}
    </MTPContext.Provider>
  );
}

export function useMTP(): ContextType {
  const context = useContext(MTPContext);
  if (!context) throw new Error("useMTP must be used within an MTP Provider");
  return context;
}
