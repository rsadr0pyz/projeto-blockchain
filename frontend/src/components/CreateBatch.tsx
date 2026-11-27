
import { useEffect, useState } from 'react'

import { useConnection, useWaitForTransactionReceipt, useWriteContract} from 'wagmi'

// import { COFFEE_FACTORY_ADDRESS, coffeeFactoryAbi } from '../../../contracts/factory'

export function CreateBatch() {
  const connection = useConnection()

  const [quantitySack, setQuantitySack] = useState('')
  const [originLocation, setOriginLocation] = useState('')
  const [storageLocation, setStorageLocation] = useState('')

  const isConnected = connection.status === 'connected'


  const writeContract = useWriteContract()

  const {
    data: hash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract()

  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash })

  const isDisabled = connection.status !== 'connected' || isPending || isConfirming  

  function handleCreateBatch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!isConnected) return

    // writeContract.mutate({
    //   address: FACTORY_ADDRESS,
    //   abi: COFFEE_CHAIN_ABI,
    //   functionName: 'createBatch',
    //   args: [
    //     quantitySack,
    //     originLocation.trim(),
    //     storageLocation.trim(),
    //   ],
    // })
  }

  useEffect(() => {
    if (isConfirmed) {
      setQuantitySack('')
      setOriginLocation('')
      setStorageLocation('')
    }
  }, [isConfirmed])

  return (
    <section >
      <h2>1. Criar Novo Lote</h2>
      <form onSubmit={handleCreateBatch} className="form-stack">
        <label>
          Quantidade (Sacas):
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
          {isPending ? 'Assinando na carteira...'
          : isConfirming ? 'Criando contrato do lote...'
          : 'Registrar Lote'}
        </button>
      </form>

      {hash && (
        <p className="status-text">
          Transação enviada: <code>{hash}</code>
        </p>
      )}

      {(writeError || receiptError) && (
        <p className="error-text">
          {(writeError || receiptError)?.message}
        </p>
      )}
    </section>
  )
}