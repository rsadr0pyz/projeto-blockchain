import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'

export function WalletConn() {
  const connection = useConnection()
  const { connect, status, error } = useConnect()
  const connectors = useConnectors()
  const { disconnect } = useDisconnect()

  const isConnected = connection.status === 'connected'
  const activeAddress = connection.addresses?.[0]

  return (
    <header className="wallet-header">
      <div>
        <h2>Connection</h2>

        <div>
            status: {connection.status}
            <br />
            addresses: {JSON.stringify(connection.addresses)}
            <br />
            chainId: {connection.chainId}
        </div>

        {isConnected && (
            <button type="button" onClick={() => disconnect()}>
            Disconnect
            </button>
        )}

        {!isConnected && (
          <p className="muted">Conecte sua carteira.</p>
        )}

        {!isConnected && connectors.map((connector) => (
            <button
            key={connector.uid}
            onClick={() => connect({ connector })}
            type="button"
            >
            {connector.name}
            </button>
        ))}

        <div>{error?.message}</div>
      </div>

    </header>
  )
}