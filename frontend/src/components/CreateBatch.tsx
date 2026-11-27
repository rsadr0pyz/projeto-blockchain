
import { useEffect, useState, type FormEvent } from 'react'
import { parseEventLogs, type Address } from 'viem'
import { useConnection, useWaitForTransactionReceipt, useWriteContract} from 'wagmi'

// import { COFFEE_FACTORY_ADDRESS, coffeeFactoryAbi } from '../../../contracts/factory'


export function CreateBatch() {
  const connection = useConnection()

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
    <div>
      <h2>1. Criar Novo Lote</h2>
      <form onSubmit={handleCreateBatch} className="form-stack">
        <label>
          Quantidade Inicial (Sacas):
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
  )
}