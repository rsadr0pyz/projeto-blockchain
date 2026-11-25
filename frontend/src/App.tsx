import { useConnect, useConnection, useConnectors, useDisconnect, useWriteContract } from 'wagmi'

import { CoffeeStage } from './coffee'

import { useState } from 'react'

const FACTORY_ADDRESS = 0x0 // tem q ver

const COFFEE_CHAIN_ABI = 0x0 // tem q ver tbm

function App() {
  const connection = useConnection()
  const { connect, status, error } = useConnect()
  const connectors = useConnectors()
  const { disconnect } = useDisconnect()


  const [quantitySack, setQuantitySack] = useState('')
  const [originLocation, setOriginLocation] = useState('')
  const [storageLocation, setStorageLocation] = useState('')

  const isConnected = connection.status === 'connected'


  const writeContract = useWriteContract()

  function handleCreateBatch() {
    if (!isConnected) return

    writeContract.mutate({
      address: FACTORY_ADDRESS,
      abi: COFFEE_CHAIN_ABI,
      functionName: 'createBatch',
      args: [
        quantitySack,
        originLocation.trim(),
        storageLocation.trim(),
      ],
    })
  }

  return (
    <>
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

      <div>
        <h2>1. Criar Novo Lote</h2>
        <form onSubmit={handleCreateBatch} className="form-stack">
          <label>
            Quantidade Inicial (Kg):
            <input
              type="number"
              min="1"
              step="1"
              required
              value={quantitySack}
              onChange={(e) => setQuantitySack(e.target.value)}
              />
          </label>

          <label>
              Origem:
              <input
                type="text"
                required
                value={originLocation}
                onChange={(e) => setOriginLocation(e.target.value)}
              />
          </label>

          <label>
            Local de Armazenamento:
            <input
              type="text"
              required
              value={storageLocation}
              onChange={(e) => setStorageLocation(e.target.value)}
            />
          </label>

          <button type="submit" disabled={!isConnected}>
            {'Registrar Lote'}
          </button>
        </form>
      </div>
    </>
    
  )
}

export default App
