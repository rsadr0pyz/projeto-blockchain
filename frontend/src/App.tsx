import { WalletConn } from './components/WalletConn'
import { CreateBatch } from './components/CreateBatch'
import { useConnection } from 'wagmi'




function App() {
  const isConnected = useConnection().status === 'connected'
  return (
    <>
      <WalletConn/>
      {isConnected && (<CreateBatch/>)}
    </>
  )
}

export default App
