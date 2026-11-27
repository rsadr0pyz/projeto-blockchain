import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'

export function WalletConn() {
  const connection = useConnection()
  const { connect, status, error } = useConnect()
  const connectors = useConnectors()
  const { disconnect } = useDisconnect()

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

        {connection.status === 'connected' && (
            <button type="button" onClick={() => disconnect()}>
            Disconnect
            </button>
        )}
        </div>

        <div>
        <h2>Connect</h2>
        {connectors.map((connector) => (
            <button
            key={connector.uid}
            onClick={() => connect({ connector })}
            type="button"
            >
            {connector.name}
            </button>
        ))}
        <div>{status}</div>
        <div>{error?.message}</div>
      </div>

    </header>
  )
}